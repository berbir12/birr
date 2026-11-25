/**
 * The single ingestion pipeline. Bot pastes, the SMS webhook and bulk imports all call ingestBatch.
 *
 *   parse → order undated items by balance chain → dedupe → resolve account/person
 *         → categorize → store (raw encrypted) → update cached account balance
 *
 * Idempotent: the same SMS ingested twice returns `duplicate` and creates nothing.
 */
import { createHmac } from 'node:crypto';
import { categorize, orderByBalanceChain, type Rule } from '@birr/core';
import { parseSms } from '@birr/parser';
import { tidyName, type IngestChannel, type ParsedSms, type Source } from '@birr/shared';
import { and, eq, sql } from 'drizzle-orm';
import { encrypt, keyedHash } from '../crypto.js';
import type { DB, Tx } from '../db/client.js';
import { accounts, categories, people, rawMessages, rules, transactions } from '../db/schema.js';

export interface IngestDeps {
  db: DB;
  encKey: Buffer;
}

export interface IngestInput {
  body: string;
  sender?: string | null;
  /** Unix ms. For bot pastes this is when the paste arrived, not when the SMS did. */
  receivedAt: number;
}

export type IngestOutcome =
  | { status: 'created'; txId: number; rawId: number }
  | { status: 'duplicate'; txId: number | null; rawId: number; restored: boolean }
  | { status: 'review'; rawId: number; reason: 'no_template' | 'low_confidence'; duplicate: boolean }
  | { status: 'ignored'; reason: 'unknown_sender' };

/** Parsed items below this confidence go to the review queue instead of becoming transactions. */
export const MIN_CONFIDENCE = 0.8;

/** Spacing between estimated timestamps of undated messages in one batch. */
const ESTIMATE_STEP_MS = 1000;

export function hashKey(encKey: Buffer): Buffer {
  // Separate subkey so dedupe hashes and ciphertexts never share key material directly.
  return createHmac('sha256', encKey).update('birr/dedupe/v1').digest();
}

const normBody = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Dedupe key: the transaction reference when the SMS has one; otherwise
 * sender + normalised body (+ timestamp for webhook deliveries, where it is the real SMS time).
 */
export function dedupeKey(key: Buffer, channel: IngestChannel, input: IngestInput, parsed: ParsedSms | null): string {
  if (parsed?.reference) return keyedHash(`ref|${parsed.source}|${parsed.reference}`, key);
  const ts = parsed?.occurredAt ?? (channel === 'webhook' ? String(input.receivedAt) : '');
  return keyedHash(`raw|${parsed?.source ?? input.sender ?? ''}|${normBody(input.body)}|${ts}`, key);
}

/** Assigns occurred_at to every parsed item; undated ones get estimates ordered by balance chain. */
function assignTimes(items: Array<{ input: IngestInput; parsed: ParsedSms }>): Array<{ at: number; estimated: boolean }> {
  const out = items.map(({ input, parsed }) =>
    parsed.occurredAt ? { at: Date.parse(parsed.occurredAt), estimated: false } : { at: input.receivedAt, estimated: true },
  );

  // Group undated items per account so the chain is followed within one account only.
  const groups = new Map<string, number[]>();
  items.forEach(({ parsed }, i) => {
    if (parsed.occurredAt) return;
    const k = `${parsed.source}|${parsed.accountMaskedId ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const idxs of groups.values()) {
    const order = orderByBalanceChain(idxs.map((i) => items[i]!.parsed));
    const latest = Math.max(...idxs.map((i) => items[i]!.input.receivedAt));
    order.forEach((pos, rank) => {
      out[idxs[pos]!] = { at: latest - (order.length - 1 - rank) * ESTIMATE_STEP_MS, estimated: true };
    });
  }
  return out;
}

async function resolveAccount(tx: Tx, userId: number, source: Source, maskedId: string | null): Promise<number> {
  const type = source; // 'telebirr' | 'cbe' map 1:1 to account types
  const existing = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.type, type)))
    .orderBy(accounts.id);

  // telebirr: one wallet per user. CBE: one account per masked number.
  const match =
    type === 'telebirr'
      ? existing[0]
      : (existing.find((a) => a.maskedId === maskedId) ?? (maskedId === null ? existing[0] : undefined));

  if (match) {
    if (!match.maskedId && maskedId) await tx.update(accounts).set({ maskedId }).where(eq(accounts.id, match.id));
    return match.id;
  }
  const name = type === 'telebirr' ? 'telebirr' : `CBE ${maskedId ?? ''}`.trim();
  const [created] = await tx.insert(accounts).values({ userId, type, name, maskedId }).returning({ id: accounts.id });
  return created!.id;
}

/** People are only the humans/businesses I pay or get paid by — not agents or banks. */
async function resolvePerson(tx: Tx, userId: number, p: ParsedSms): Promise<number | null> {
  if (!p.counterpartyName || (p.kind !== 'transfer_out' && p.kind !== 'transfer_in')) return null;
  const display = tidyName(p.counterpartyName);
  const found = await tx
    .select({ id: people.id, maskedId: people.maskedId })
    .from(people)
    .where(and(eq(people.userId, userId), sql`lower(${people.displayName}) = ${display.toLowerCase()}`));
  // Same name and (same masked id, or one of them unknown). Last-4 alone collides too easily.
  const hit = found.find((f) => !f.maskedId || !p.counterpartyMaskedId || f.maskedId === p.counterpartyMaskedId);
  if (hit) return hit.id;
  const [created] = await tx
    .insert(people)
    .values({ userId, displayName: display, maskedId: p.counterpartyMaskedId })
    .returning({ id: people.id });
  return created!.id;
}

export async function loadRules(db: DB, userId: number): Promise<{ rules: Rule[]; categoryIds: Map<string, number> }> {
  const cats = await db.select({ id: categories.id, key: categories.key }).from(categories).where(eq(categories.userId, userId));
  const keyById = new Map(cats.map((c) => [c.id, c.key]));
  const rows = await db.select().from(rules).where(eq(rules.userId, userId));
  return {
    rules: rows.flatMap((r) => {
      const key = keyById.get(r.categoryId);
      return key ? [{ field: r.field, pattern: r.pattern, categoryKey: key, priority: r.priority }] : [];
    }),
    categoryIds: new Map(cats.map((c) => [c.key, c.id])),
  };
}

export async function ingestBatch(
  deps: IngestDeps,
  userId: number,
  channel: IngestChannel,
  inputs: readonly IngestInput[],
): Promise<IngestOutcome[]> {
  const { db, encKey } = deps;
  const hk = hashKey(encKey);
  const outcomes: IngestOutcome[] = new Array(inputs.length);

  const parsedItems: Array<{ i: number; input: IngestInput; parsed: ParsedSms }> = [];
  const unparsed: Array<{ i: number; input: IngestInput; reason: 'no_template' }> = [];
  inputs.forEach((input, i) => {
    const r = parseSms({ body: input.body, sender: input.sender });
    if (r.ok) parsedItems.push({ i, input, parsed: r.tx });
    else if (r.reason === 'unknown_sender' || r.reason === 'not_a_transaction')
      outcomes[i] = { status: 'ignored', reason: 'unknown_sender' };
    else unparsed.push({ i, input, reason: r.reason });
  });

  const times = assignTimes(parsedItems);

  await db.transaction(async (tx) => {
    const { rules: userRules, categoryIds } = await loadRules(tx, userId);

    const findRaw = async (key: string) =>
      (
        await tx
          .select({ id: rawMessages.id, status: rawMessages.status })
          .from(rawMessages)
          .where(and(eq(rawMessages.userId, userId), eq(rawMessages.dedupeKey, key)))
          .limit(1)
      )[0];

    const insertRaw = async (
      input: IngestInput,
      key: string,
      status: 'parsed' | 'review',
      extra: Partial<typeof rawMessages.$inferInsert> = {},
    ) => {
      const [row] = await tx
        .insert(rawMessages)
        .values({
          userId,
          channel,
          sender: input.sender ?? 'unknown',
          bodyEnc: encrypt(input.body, encKey),
          dedupeKey: key,
          receivedAt: input.receivedAt,
          status,
          ...extra,
        })
        .returning({ id: rawMessages.id });
      return row!.id;
    };

    for (const { i, input, reason } of unparsed) {
      const key = dedupeKey(hk, channel, input, null);
      const existing = await findRaw(key);
      outcomes[i] = existing
        ? { status: 'review', rawId: existing.id, reason, duplicate: true }
        : { status: 'review', rawId: await insertRaw(input, key, 'review', { parseError: reason }), reason, duplicate: false };
    }

    for (let n = 0; n < parsedItems.length; n++) {
      const { i, input, parsed } = parsedItems[n]!;
      const key = dedupeKey(hk, channel, input, parsed);
      const sender = input.sender ?? parsed.source;
      const existing = await findRaw(key);
      if (existing) {
        const [t] = await tx
          .select({ id: transactions.id, deletedAt: transactions.deletedAt })
          .from(transactions)
          .where(eq(transactions.rawMessageId, existing.id))
          .limit(1);
        if (t?.deletedAt) await tx.update(transactions).set({ deletedAt: null }).where(eq(transactions.id, t.id));
        outcomes[i] =
          existing.status === 'review' && !t
            ? { status: 'review', rawId: existing.id, reason: 'low_confidence', duplicate: true }
            : { status: 'duplicate', txId: t?.id ?? null, rawId: existing.id, restored: Boolean(t?.deletedAt) };
        continue;
      }

      const { raw: _raw, ...candidate } = parsed;
      if (parsed.confidence < MIN_CONFIDENCE) {
        const rawId = await insertRaw({ ...input, sender }, key, 'review', {
          template: parsed.template,
          confidence: parsed.confidence,
          parseError: parsed.warnings.join(',') || 'low_confidence',
          candidate,
        });
        outcomes[i] = { status: 'review', rawId, reason: 'low_confidence', duplicate: false };
        continue;
      }

      const rawId = await insertRaw({ ...input, sender }, key, 'parsed', {
        template: parsed.template,
        confidence: parsed.confidence,
      });
      const accountId = await resolveAccount(tx, userId, parsed.source, parsed.accountMaskedId);
      const personId = await resolvePerson(tx, userId, parsed);
      const { categoryKey } = categorize(parsed, userRules);
      const { at, estimated } = times[n]!;

      const [created] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId,
          rawMessageId: rawId,
          channel,
          source: parsed.source,
          direction: parsed.direction,
          kind: parsed.kind,
          amount: parsed.amount,
          fee: parsed.fee,
          vat: parsed.vat,
          otherCharges: parsed.otherCharges,
          balanceAfter: parsed.balanceAfter,
          counterpartyName: parsed.counterpartyName,
          counterpartyMaskedId: parsed.counterpartyMaskedId,
          personId,
          reference: parsed.reference,
          receiptUrl: parsed.receiptUrl,
          occurredAt: at,
          occurredAtEstimated: estimated,
          categoryId: categoryIds.get(categoryKey) ?? categoryIds.get('other') ?? null,
          confidence: parsed.confidence,
        })
        .returning({ id: transactions.id });

      if (parsed.balanceAfter !== null) {
        await tx
          .update(accounts)
          .set({ balance: parsed.balanceAfter, balanceAt: at })
          .where(and(eq(accounts.id, accountId), sql`coalesce(${accounts.balanceAt}, 0) <= ${at}`));
      }
      outcomes[i] = { status: 'created', txId: created!.id, rawId };
    }
  });

  return outcomes;
}

/** Number of messages waiting in the review queue. */
export async function reviewCount(db: DB, userId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.status, 'review')));
  return row?.n ?? 0;
}
