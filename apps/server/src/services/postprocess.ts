/**
 * Runs after every ingest (inside the same DB transaction):
 *  1. balance reconciliation for each touched account → transactions.reconciliation ('ok' | 'gap' | 'unknown')
 *  2. internal-transfer linking between my own accounts → shared transactions.transfer_group_id
 */
import { randomUUID } from 'node:crypto';
import { matchInternalTransfers, reconcile } from '@birr/core';
import { and, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { categories, transactions } from '../db/schema.js';

const CHUNK = 1000;

/** Recomputes reconciliation for whole accounts and writes only rows whose status changed. */
export async function reconcileAccounts(db: DB, userId: number, accountIds: readonly number[]): Promise<number> {
  let changed = 0;
  for (const accountId of new Set(accountIds)) {
    const rows = await db
      .select({
        id: transactions.id,
        occurredAt: transactions.occurredAt,
        direction: transactions.direction,
        amount: transactions.amount,
        fee: transactions.fee,
        vat: transactions.vat,
        otherCharges: transactions.otherCharges,
        balanceAfter: transactions.balanceAfter,
        reconciliation: transactions.reconciliation,
        reconciliationDelta: transactions.reconciliationDelta,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId), isNull(transactions.deletedAt)));
    const before = new Map(rows.map((r) => [r.id, r]));
    const updates = reconcile(rows).filter((r) => {
      const b = before.get(r.id)!;
      return b.reconciliation !== r.status || (b.reconciliationDelta ?? null) !== r.delta;
    });

    for (let i = 0; i < updates.length; i += CHUNK) {
      const part = updates.slice(i, i + CHUNK);
      const values = sql.join(
        part.map((u) => sql`(${u.id}::int, ${u.status}::text, ${u.delta}::bigint)`),
        sql`, `,
      );
      await db.execute(sql`
        update birr.transactions as t
        set reconciliation = v.status, reconciliation_delta = v.delta
        from (values ${values}) as v(id, status, delta)
        where t.id = v.id and t.user_id = ${userId}`);
    }
    changed += updates.length;
  }
  return changed;
}

/** Widest window the matcher uses (estimated CBE times), plus margin. */
const LINK_WINDOW_MS = 7 * 60 * 60 * 1000;

/**
 * Links internal transfers that involve at least one of `newTxIds`. Linked legs move to the
 * "Transfers" category unless I've already confirmed/categorized them myself.
 */
export async function linkInternalTransfers(db: DB, userId: number, newTxIds: readonly number[]): Promise<number> {
  if (!newTxIds.length) return 0;
  const fresh = new Set(newTxIds);
  const span = await db
    .select({ lo: sql<number>`min(${transactions.occurredAt})`, hi: sql<number>`max(${transactions.occurredAt})` })
    .from(transactions)
    .where(inArray(transactions.id, [...fresh]));
  const lo = Number(span[0]?.lo);
  const hi = Number(span[0]?.hi);
  if (!Number.isFinite(lo)) return 0;

  const candidates = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      direction: transactions.direction,
      kind: transactions.kind,
      amount: transactions.amount,
      occurredAt: transactions.occurredAt,
      occurredAtEstimated: transactions.occurredAtEstimated,
      counterpartyName: transactions.counterpartyName,
      transferGroupId: transactions.transferGroupId,
      confirmedAt: transactions.confirmedAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(transactions.transferGroupId),
        between(transactions.occurredAt, lo - LINK_WINDOW_MS, hi + LINK_WINDOW_MS),
      ),
    );
  const pairs = matchInternalTransfers(candidates).filter(([a, b]) => fresh.has(a) || fresh.has(b));
  if (!pairs.length) return 0;

  const [transfersCat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.key, 'transfers')))
    .limit(1);
  const confirmed = new Set(candidates.filter((c) => c.confirmedAt !== null).map((c) => c.id));

  for (const [outId, inId] of pairs) {
    const group = randomUUID();
    for (const id of [outId, inId]) {
      await db
        .update(transactions)
        .set({
          transferGroupId: group,
          ...(transfersCat && !confirmed.has(id) ? { categoryId: transfersCat.id } : {}),
        })
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    }
  }
  return pairs.length;
}

/** Undo a link (e.g. it really was a payment to someone). */
export async function unlinkTransfer(db: DB, userId: number, txId: number): Promise<boolean> {
  const [t] = await db
    .select({ group: transactions.transferGroupId })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
    .limit(1);
  if (!t?.group) return false;
  await db
    .update(transactions)
    .set({ transferGroupId: null })
    .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, t.group)));
  return true;
}
