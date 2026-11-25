/**
 * The single ingestion pipeline. Bot pastes, the SMS webhook and bulk imports all call ingestBatch.
 *
 *   parse → order undated items by balance chain → dedupe (DB + within the batch)
 *         → resolve accounts/people → categorize → bulk insert (raw SMS encrypted)
 *         → update cached balances → reconcile touched accounts → link internal transfers
 *
 * Bulk by design: a fixed number of queries per batch regardless of size, so a backfill of
 * thousands of SMS fits in one serverless invocation. Idempotent: re-ingesting creates nothing.
 * `dryRun` runs everything and rolls back, giving exact preview counts.
 */
import { createHmac } from 'node:crypto';
import { categorize, orderByBalanceChain, type Rule } from '@birr/core';
import { parseSms } from '@birr/parser';
import { tidyName, type IngestChannel, type ParsedSms, type Source } from '@birr/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { encrypt, keyedHash } from '../crypto.js';
import type { DB, Tx } from '../db/client.js';
import { accounts, categories, people, rawMessages, rules, transactions } from '../db/schema.js';
import { linkInternalTransfers, reconcileAccounts } from './postprocess.js';

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

export interface IngestOptions {
  /** Run the whole pipeline, then roll back. Outcome ids are meaningless; counts are exact. */
  dryRun?: boolean;
}

/** Parsed items below this confidence go to the review queue instead of becoming transactions. */
export const MIN_CONFIDENCE = 0.8;

/** Spacing between estimated timestamps of undated messages that arrived together. */
const ESTIMATE_STEP_MS = 1000;
const INSERT_CHUNK = 500;

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

/**
 * occurred_at for every parsed item. SMS with a date use it. Undated ones (CBE) use their received
 * time; when several share the same received time (a paste), the balance chain decides their order.
 */
function assignTimes(items: Array<{ input: IngestInput; parsed: ParsedSms }>): Array<{ at: number; estimated: boolean }> {
  const out = items.map(({ input, parsed }) =>
    parsed.occurredAt ? { at: Date.parse(parsed.occurredAt), estimated: false } : { at: input.receivedAt, estimated: true },
  );
  const groups = new Map<string, number[]>();
  items.forEach(({ input, parsed }, i) => {
    if (parsed.occurredAt) return;
    const k = `${parsed.source}|${parsed.accountMaskedId ?? ''}|${input.receivedAt}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const order = orderByBalanceChain(idxs.map((i) => items[i]!.parsed));
    const latest = items[idxs[0]!]!.input.receivedAt;
    order.forEach((pos, rank) => {
      out[idxs[pos]!] = { at: latest - (order.length - 1 - rank) * ESTIMATE_STEP_MS, estimated: true };
    });
  }
  return out;
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

function chunks<T>(xs: readonly T[], n = INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Resolves accounts in memory, creating missing ones (rare: once per new wallet/bank account). */
async function accountResolver(tx: Tx, userId: number) {
  const all = await tx.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.id);
  return async (source: Source, maskedId: string | null): Promise<number> => {
    const same = all.filter((a) => a.type === source);
    // telebirr: one wallet per user. CBE: one account per masked number.
    const match =
      source === 'telebirr' ? same[0] : (same.find((a) => a.maskedId === maskedId) ?? (maskedId === null ? same[0] : undefined));
    if (match) {
      if (!match.maskedId && maskedId) {
        await tx.update(accounts).set({ maskedId }).where(eq(accounts.id, match.id));
        match.maskedId = maskedId;
      }
      return match.id;
    }
    const name = source === 'telebirr' ? 'telebirr' : `CBE ${maskedId ?? ''}`.trim();
    const [created] = await tx.insert(accounts).values({ userId, type: source, name, maskedId }).returning();
    all.push(created!);
    return created!.id;
  };
}

/** People are only the humans/businesses I pay or get paid by — not agents or banks. */
async function personResolver(tx: Tx, userId: number) {
  const known = await tx
    .select({ id: people.id, displayName: people.displayName, maskedId: people.maskedId })
    .from(people)
    .where(eq(people.userId, userId));
  const pending: Array<{ displayName: string; maskedId: string | null; id?: number }> = [];
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // Same name and (same masked id, or one of them unknown). Last-4 alone collides too easily.
  const sameId = (a: string | null, b: string | null) => !a || !b || a === b;

  return {
    /** Returns a person id, or a pending person to be inserted. */
    resolve(p: ParsedSms): number | (typeof pending)[number] | null {
      if (!p.counterpartyName || (p.kind !== 'transfer_out' && p.kind !== 'transfer_in')) return null;
      const display = tidyName(p.counterpartyName);
      const hit = known.find((k) => sameName(k.displayName, display) && sameId(k.maskedId, p.counterpartyMaskedId));
      if (hit) return hit.id;
      const queued = pending.find((k) => sameName(k.displayName, display) && sameId(k.maskedId, p.counterpartyMaskedId));
      if (queued) return queued;
      const fresh = { displayName: display, maskedId: p.counterpartyMaskedId };
      pending.push(fresh);
      return fresh;
    },
    async flush() {
      for (const part of chunks(pending)) {
        const rows = await tx
          .insert(people)
          .values(part.map((p) => ({ userId, displayName: p.displayName, maskedId: p.maskedId })))
          .returning({ id: people.id });
        rows.forEach((r, i) => (part[i]!.id = r.id));
      }
    },
  };
}

class DryRunRollback extends Error {}

export async function ingestBatch(
  deps: IngestDeps,
  userId: number,
  channel: IngestChannel,
  inputs: readonly IngestInput[],
  opts: IngestOptions = {},
): Promise<IngestOutcome[]> {
  const { db, encKey } = deps;
  const hk = hashKey(encKey);
  const outcomes: IngestOutcome[] = new Array(inputs.length);

  const parsedItems: Array<{ i: number; input: IngestInput; parsed: ParsedSms }> = [];
  const unparsed: Array<{ i: number; input: IngestInput }> = [];
  inputs.forEach((input, i) => {
    const r = parseSms({ body: input.body, sender: input.sender });
    if (r.ok) parsedItems.push({ i, input, parsed: r.tx });
    else if (r.reason === 'no_template') unparsed.push({ i, input });
    else outcomes[i] = { status: 'ignored', reason: 'unknown_sender' };
  });
  const times = assignTimes(parsedItems);

  try {
    await db.transaction(async (tx) => {
      const { rules: userRules, categoryIds } = await loadRules(tx, userId);

      // ---- 1. dedupe against the database, in bulk ----
      const keyed = [
        ...unparsed.map((u) => ({ ...u, parsed: null as ParsedSms | null, n: -1, key: dedupeKey(hk, channel, u.input, null) })),
        ...parsedItems.map((p, n) => ({ ...p, n, key: dedupeKey(hk, channel, p.input, p.parsed) })),
      ];
      const existingRaw = new Map<string, { id: number; status: string }>();
      for (const part of chunks([...new Set(keyed.map((k) => k.key))])) {
        const rows = await tx
          .select({ id: rawMessages.id, status: rawMessages.status, key: rawMessages.dedupeKey })
          .from(rawMessages)
          .where(and(eq(rawMessages.userId, userId), inArray(rawMessages.dedupeKey, part)));
        for (const r of rows) existingRaw.set(r.key, r);
      }
      const existingTx = new Map<number, { id: number; deletedAt: number | null }>();
      for (const part of chunks([...existingRaw.values()].map((r) => r.id))) {
        const rows = await tx
          .select({ id: transactions.id, rawId: transactions.rawMessageId, deletedAt: transactions.deletedAt })
          .from(transactions)
          .where(inArray(transactions.rawMessageId, part));
        for (const r of rows) existingTx.set(r.rawId!, r);
      }

      // ---- 2. plan ----
      const resolveAccount = await accountResolver(tx, userId);
      const persons = await personResolver(tx, userId);
      type PlannedRaw = typeof rawMessages.$inferInsert & { dedupeKey: string };
      const rawPlan: PlannedRaw[] = [];
      const txPlan: Array<{ key: string; values: Omit<typeof transactions.$inferInsert, 'rawMessageId' | 'personId'>; person: ReturnType<typeof persons.resolve> }> = [];
      const restoreIds: number[] = [];
      const firstInBatch = new Map<string, number>(); // key → input index that will create it
      const deferred: Array<{ i: number; key: string; kind: 'review' | 'duplicate'; reason?: 'no_template' | 'low_confidence' }> = [];

      const rawValues = (input: IngestInput, key: string, status: 'parsed' | 'review', extra: Partial<PlannedRaw> = {}): PlannedRaw => ({
        userId,
        channel,
        sender: input.sender ?? 'unknown',
        bodyEnc: encrypt(input.body, encKey),
        dedupeKey: key,
        receivedAt: input.receivedAt,
        status,
        ...extra,
      });

      for (const k of keyed) {
        const { i, input, parsed, key } = k;
        const existing = existingRaw.get(key);
        if (existing) {
          const t = existingTx.get(existing.id);
          if (t?.deletedAt) restoreIds.push(t.id);
          outcomes[i] =
            existing.status === 'review' && !t
              ? { status: 'review', rawId: existing.id, reason: parsed ? 'low_confidence' : 'no_template', duplicate: true }
              : { status: 'duplicate', txId: t?.id ?? null, rawId: existing.id, restored: Boolean(t?.deletedAt) };
          continue;
        }
        if (firstInBatch.has(key)) {
          // Same SMS twice in one paste/file: the second one is a duplicate of the first.
          deferred.push({ i, key, kind: parsed && parsed.confidence >= MIN_CONFIDENCE ? 'duplicate' : 'review', reason: parsed ? 'low_confidence' : 'no_template' });
          continue;
        }
        firstInBatch.set(key, i);

        if (!parsed) {
          rawPlan.push(rawValues(input, key, 'review', { parseError: 'no_template' }));
          continue;
        }
        const sender = input.sender ?? parsed.source;
        if (parsed.confidence < MIN_CONFIDENCE) {
          const { raw: _raw, ...candidate } = parsed;
          rawPlan.push(
            rawValues({ ...input, sender }, key, 'review', {
              template: parsed.template,
              confidence: parsed.confidence,
              parseError: parsed.warnings.join(',') || 'low_confidence',
              candidate,
            }),
          );
          continue;
        }
        rawPlan.push(rawValues({ ...input, sender }, key, 'parsed', { template: parsed.template, confidence: parsed.confidence }));
        const { at, estimated } = times[k.n]!;
        txPlan.push({
          key,
          person: persons.resolve(parsed),
          values: {
            userId,
            accountId: await resolveAccount(parsed.source, parsed.accountMaskedId),
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
            reference: parsed.reference,
            receiptUrl: parsed.receiptUrl,
            occurredAt: at,
            occurredAtEstimated: estimated,
            categoryId: categoryIds.get(categorize(parsed, userRules).categoryKey) ?? categoryIds.get('other') ?? null,
            confidence: parsed.confidence,
          },
        });
      }

      // ---- 3. write, in bulk ----
      await persons.flush();
      const rawIdByKey = new Map<string, number>();
      for (const part of chunks(rawPlan)) {
        const rows = await tx.insert(rawMessages).values(part).returning({ id: rawMessages.id, key: rawMessages.dedupeKey });
        for (const r of rows) rawIdByKey.set(r.key, r.id);
      }
      const txIdByRaw = new Map<number, number>();
      for (const part of chunks(txPlan)) {
        const rows = await tx
          .insert(transactions)
          .values(
            part.map((p) => ({
              ...p.values,
              rawMessageId: rawIdByKey.get(p.key)!,
              personId: typeof p.person === 'number' ? p.person : (p.person?.id ?? null),
            })),
          )
          .returning({ id: transactions.id, rawId: transactions.rawMessageId });
        for (const r of rows) txIdByRaw.set(r.rawId!, r.id);
      }
      if (restoreIds.length) await tx.update(transactions).set({ deletedAt: null }).where(inArray(transactions.id, restoreIds));

      // ---- 4. outcomes for newly written rows ----
      for (const [key, i] of firstInBatch) {
        const rawId = rawIdByKey.get(key)!;
        const txId = txIdByRaw.get(rawId);
        const parsed = parsedItems.find((p) => p.i === i);
        outcomes[i] =
          txId !== undefined
            ? { status: 'created', txId, rawId }
            : { status: 'review', rawId, reason: parsed ? 'low_confidence' : 'no_template', duplicate: false };
      }
      for (const d of deferred) {
        const rawId = rawIdByKey.get(d.key)!;
        const txId = txIdByRaw.get(rawId);
        outcomes[d.i] =
          txId !== undefined
            ? { status: 'duplicate', txId, rawId, restored: false }
            : { status: 'review', rawId, reason: d.reason ?? 'no_template', duplicate: true };
      }

      // ---- 5. cached balances: latest reported balance per account ----
      const latest = new Map<number, { at: number; balance: number }>();
      for (const p of txPlan) {
        const { accountId, balanceAfter, occurredAt } = p.values;
        if (balanceAfter === null || balanceAfter === undefined) continue;
        const cur = latest.get(accountId);
        if (!cur || occurredAt >= cur.at) latest.set(accountId, { at: occurredAt, balance: balanceAfter });
      }
      for (const [accountId, { at, balance }] of latest) {
        await tx
          .update(accounts)
          .set({ balance, balanceAt: at })
          .where(and(eq(accounts.id, accountId), sql`coalesce(${accounts.balanceAt}, 0) <= ${at}`));
      }

      // ---- 6. reconciliation + internal transfers ----
      const touched = new Set(txPlan.map((p) => p.values.accountId));
      if (restoreIds.length) {
        const restored = await tx.select({ a: transactions.accountId }).from(transactions).where(inArray(transactions.id, restoreIds));
        for (const r of restored) touched.add(r.a);
      }
      if (touched.size) await reconcileAccounts(tx, userId, [...touched]);
      await linkInternalTransfers(tx, userId, [...txIdByRaw.values()]);

      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }

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
