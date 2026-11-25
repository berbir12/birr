/**
 * Review queue: SMS that didn't parse (unknown format) or parsed with low confidence.
 * Each can be fixed by hand (→ transaction), dismissed (not a transaction), or re-parsed after
 * new templates ship.
 */
import type { ReviewItem, ReviewResolveBody } from '@birr/shared';
import { and, asc, eq } from 'drizzle-orm';
import { decrypt } from '../crypto.js';
import type { DB } from '../db/client.js';
import { accounts, categories, rawMessages, transactions } from '../db/schema.js';
import { ingestBatch, type IngestOutcome } from './ingest.js';
import { linkInternalTransfers, reconcileAccounts } from './postprocess.js';

export async function listReview(db: DB, encKey: Buffer, userId: number): Promise<ReviewItem[]> {
  const rows = await db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.status, 'review')))
    .orderBy(asc(rawMessages.receivedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt,
    sender: r.sender,
    channel: r.channel,
    body: decrypt(r.bodyEnc, encKey),
    reason: r.parseError,
    candidate: r.candidate ?? null,
  }));
}

async function ownReviewItem(db: DB, userId: number, id: number) {
  const [r] = await db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.id, id), eq(rawMessages.userId, userId), eq(rawMessages.status, 'review')))
    .limit(1);
  return r;
}

/** Turns a review item into a transaction from hand-entered fields. */
export async function resolveReview(db: DB, userId: number, id: number, body: ReviewResolveBody): Promise<number | null> {
  const item = await ownReviewItem(db, userId, id);
  if (!item) return null;
  return db.transaction(async (tx) => {
    let [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.type, body.source)))
      .orderBy(accounts.id)
      .limit(1);
    if (!account) {
      [account] = await tx
        .insert(accounts)
        .values({ userId, type: body.source, name: body.source === 'telebirr' ? 'telebirr' : 'CBE' })
        .returning({ id: accounts.id });
    }
    let categoryId = body.categoryId ?? null;
    if (categoryId !== null) {
      const [own] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
      if (!own) categoryId = null;
    }
    const [created] = await tx
      .insert(transactions)
      .values({
        userId,
        accountId: account!.id,
        rawMessageId: item.id,
        channel: item.channel,
        source: body.source,
        direction: body.direction,
        kind: body.kind,
        amount: body.amount,
        fee: body.fee ?? 0,
        vat: body.vat ?? 0,
        otherCharges: body.otherCharges ?? 0,
        balanceAfter: body.balanceAfter ?? null,
        counterpartyName: body.counterpartyName?.trim() || null,
        occurredAt: body.occurredAt,
        categoryId,
        note: body.note?.trim() || null,
        confirmedAt: Date.now(),
      })
      .returning({ id: transactions.id });
    await tx.update(rawMessages).set({ status: 'resolved' }).where(eq(rawMessages.id, item.id));
    await reconcileAccounts(tx, userId, [account!.id]);
    await linkInternalTransfers(tx, userId, [created!.id]);
    return created!.id;
  });
}

export async function dismissReview(db: DB, userId: number, id: number): Promise<boolean> {
  const res = await db
    .update(rawMessages)
    .set({ status: 'ignored' })
    .where(and(eq(rawMessages.id, id), eq(rawMessages.userId, userId), eq(rawMessages.status, 'review')))
    .returning({ id: rawMessages.id });
  return res.length > 0;
}

/** Re-parses review items with the current templates. Items that now parse become transactions. */
export async function retryReview(db: DB, encKey: Buffer, userId: number, ids?: number[]): Promise<IngestOutcome[]> {
  const rows = await db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.status, 'review')));
  const chosen = ids ? rows.filter((r) => ids.includes(r.id)) : rows;
  if (!chosen.length) return [];
  return db.transaction(async (tx) => {
    for (const r of chosen) await tx.delete(rawMessages).where(eq(rawMessages.id, r.id));
    const byChannel = new Map<string, typeof chosen>();
    for (const r of chosen) byChannel.set(r.channel, [...(byChannel.get(r.channel) ?? []), r]);
    const out: IngestOutcome[] = [];
    for (const [channel, group] of byChannel) {
      out.push(
        ...(await ingestBatch(
          { db: tx, encKey },
          userId,
          channel as Parameters<typeof ingestBatch>[2],
          group.map((r) => ({ body: decrypt(r.bodyEnc, encKey), sender: r.sender === 'unknown' ? null : r.sender, receivedAt: r.receivedAt })),
        )),
      );
    }
    return out;
  });
}
