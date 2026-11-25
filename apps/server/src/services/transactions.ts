import { ruleFor } from '@birr/core';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { accounts, actionLog, categories, rawMessages, rules, transactions } from '../db/schema.js';

export type TxRow = typeof transactions.$inferSelect;

export interface TxView extends TxRow {
  categoryKey: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  accountName: string;
}

/** A transaction owned by `userId`, joined with its category and account names. */
export async function getTx(db: DB, userId: number, txId: number): Promise<TxView | undefined> {
  const [r] = await db
    .select({
      tx: transactions,
      categoryKey: categories.key,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
    .limit(1);
  if (!r) return undefined;
  const { tx, ...joined } = r;
  return { ...tx, ...joined };
}

export async function listCategories(db: DB, userId: number) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.archived, false)))
    .orderBy(categories.sort);
}

// ---------- action log (for /undo) ----------

export type EditableField = 'amount' | 'counterpartyName' | 'note';

export type Action =
  | { action: 'ingest'; payload: { txIds: number[]; rawIds: number[] } }
  | { action: 'delete'; payload: { txId: number } }
  | { action: 'categorize'; payload: { txId: number; prevCategoryId: number | null } }
  | { action: 'rule'; payload: { ruleId: number; changes: Array<{ txId: number; prevCategoryId: number | null }> } }
  | { action: 'edit'; payload: { txId: number; field: EditableField; prev: unknown } };

export async function logAction(db: DB, userId: number, a: Action): Promise<void> {
  await db.insert(actionLog).values({ userId, action: a.action, payload: a.payload as Record<string, unknown> });
}

// ---------- mutations ----------

const own = (userId: number, txId: number) => and(eq(transactions.id, txId), eq(transactions.userId, userId));

export async function confirmTx(db: DB, userId: number, txId: number): Promise<void> {
  await db.update(transactions).set({ confirmedAt: Date.now() }).where(own(userId, txId));
}

export async function setCategory(db: DB, userId: number, txId: number, categoryId: number): Promise<boolean> {
  const t = await getTx(db, userId, txId);
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  if (!t || !cat) return false;
  await db.update(transactions).set({ categoryId, confirmedAt: Date.now() }).where(own(userId, txId));
  await logAction(db, userId, { action: 'categorize', payload: { txId, prevCategoryId: t.categoryId } });
  return true;
}

/**
 * Saves "always categorize <counterparty> as <category>" and applies it to every past
 * transaction with the same counterparty. Returns how many other transactions changed.
 */
export async function createRuleFromTx(
  db: DB,
  userId: number,
  txId: number,
  categoryId: number,
): Promise<{ ruleId: number; updated: number } | null> {
  const t = await getTx(db, userId, txId);
  if (!t) return null;
  const r = ruleFor(t);
  if (!r) return null;

  return db.transaction(async (tx) => {
    const [rule] = await tx
      .insert(rules)
      .values({ userId, field: r.field, pattern: r.pattern, categoryId })
      .onConflictDoUpdate({ target: [rules.userId, rules.field, rules.pattern], set: { categoryId } })
      .returning({ id: rules.id });

    const match =
      r.field === 'counterparty_name'
        ? sql`lower(trim(${transactions.counterpartyName})) = ${r.pattern}`
        : eq(transactions.counterpartyMaskedId, r.pattern);
    const affected = await tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          match,
          sql`coalesce(${transactions.categoryId}, -1) <> ${categoryId}`,
        ),
      );
    if (affected.length) {
      await tx
        .update(transactions)
        .set({ categoryId })
        .where(inArray(transactions.id, affected.map((a) => a.id)));
    }
    await tx.insert(actionLog).values({
      userId,
      action: 'rule',
      payload: { ruleId: rule!.id, changes: affected.map((a) => ({ txId: a.id, prevCategoryId: a.categoryId })) },
    });
    return { ruleId: rule!.id, updated: affected.filter((a) => a.id !== txId).length };
  });
}

export async function softDelete(db: DB, userId: number, txId: number): Promise<boolean> {
  const res = await db
    .update(transactions)
    .set({ deletedAt: Date.now() })
    .where(and(own(userId, txId), isNull(transactions.deletedAt)))
    .returning({ id: transactions.id });
  if (res.length) await logAction(db, userId, { action: 'delete', payload: { txId } });
  return res.length > 0;
}

export async function restore(db: DB, userId: number, txId: number): Promise<boolean> {
  const res = await db.update(transactions).set({ deletedAt: null }).where(own(userId, txId)).returning({ id: transactions.id });
  return res.length > 0;
}

/** "#family #loan paid back" → note "paid back", tags ["family","loan"] */
export function splitNoteTags(input: string): { note: string | null; tags: string[] } {
  const tags = [...input.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]!.toLowerCase());
  const note = input.replace(/#[\p{L}\p{N}_-]+/gu, '').replace(/\s+/g, ' ').trim();
  return { note: note || null, tags: [...new Set(tags)] };
}

export async function editTx(db: DB, userId: number, txId: number, field: EditableField, value: string | number): Promise<boolean> {
  const t = await getTx(db, userId, txId);
  if (!t) return false;
  let set: Partial<TxRow>;
  let prev: unknown;
  switch (field) {
    case 'amount':
      prev = t.amount;
      set = { amount: Number(value) };
      break;
    case 'counterpartyName':
      prev = t.counterpartyName;
      set = { counterpartyName: String(value).trim() || null };
      break;
    case 'note':
      prev = { note: t.note, tags: t.tags };
      set = splitNoteTags(String(value));
      break;
  }
  await db.update(transactions).set({ ...set, confirmedAt: Date.now() }).where(own(userId, txId));
  await logAction(db, userId, { action: 'edit', payload: { txId, field, prev } });
  return true;
}

// ---------- undo ----------

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Reverts the most recent not-yet-undone action within 24h. Returns a short description. */
export async function undoLast(db: DB, userId: number, now = Date.now()): Promise<string | null> {
  const [last] = await db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.userId, userId), isNull(actionLog.undoneAt), gte(actionLog.createdAt, now - UNDO_WINDOW_MS)))
    .orderBy(desc(actionLog.id))
    .limit(1);
  if (!last) return null;

  const p = last.payload as Record<string, any>;
  return db.transaction(async (tx) => {
    let what: string;
    switch (last.action) {
      case 'ingest': {
        const txIds = p.txIds as number[];
        const rawIds = p.rawIds as number[];
        if (txIds.length) await tx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, txIds)));
        if (rawIds.length) await tx.delete(rawMessages).where(and(eq(rawMessages.userId, userId), inArray(rawMessages.id, rawIds)));
        what = `removed ${txIds.length} imported transaction${txIds.length === 1 ? '' : 's'}`;
        break;
      }
      case 'delete':
        await tx.update(transactions).set({ deletedAt: null }).where(own(userId, p.txId));
        what = 'restored the deleted transaction';
        break;
      case 'categorize':
        await tx.update(transactions).set({ categoryId: p.prevCategoryId }).where(own(userId, p.txId));
        what = 'reverted the category change';
        break;
      case 'rule':
        for (const c of p.changes as Array<{ txId: number; prevCategoryId: number | null }>) {
          await tx.update(transactions).set({ categoryId: c.prevCategoryId }).where(own(userId, c.txId));
        }
        await tx.delete(rules).where(and(eq(rules.id, p.ruleId), eq(rules.userId, userId)));
        what = 'removed the categorization rule';
        break;
      case 'edit': {
        const set =
          p.field === 'note' ? { note: p.prev?.note ?? null, tags: p.prev?.tags ?? [] } : { [p.field as string]: p.prev };
        await tx.update(transactions).set(set).where(own(userId, p.txId));
        what = 'reverted the edit';
        break;
      }
      default:
        what = 'nothing';
    }
    await tx.update(actionLog).set({ undoneAt: now }).where(eq(actionLog.id, last.id));
    return what;
  });
}

