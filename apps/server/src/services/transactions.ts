import { ruleFor } from '@birr/core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
export function getTx(db: DB, userId: number, txId: number): TxView | undefined {
  const r = db
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
    .get();
  if (!r) return undefined;
  const { tx, ...joined } = r;
  return { ...tx, ...joined };
}

export function listCategories(db: DB, userId: number) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.archived, false)))
    .orderBy(categories.sort)
    .all();
}

// ---------- action log (for /undo) ----------

export type Action =
  | { action: 'ingest'; payload: { txIds: number[]; rawIds: number[] } }
  | { action: 'delete'; payload: { txId: number } }
  | { action: 'categorize'; payload: { txId: number; prevCategoryId: number | null } }
  | { action: 'rule'; payload: { ruleId: number; changes: Array<{ txId: number; prevCategoryId: number | null }> } }
  | { action: 'edit'; payload: { txId: number; field: EditableField; prev: unknown } };

export function logAction(db: DB, userId: number, a: Action): void {
  db.insert(actionLog).values({ userId, action: a.action, payload: a.payload as Record<string, unknown> }).run();
}

// ---------- mutations ----------

export function confirmTx(db: DB, userId: number, txId: number): void {
  db.update(transactions)
    .set({ confirmedAt: Date.now() })
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
    .run();
}

export function setCategory(db: DB, userId: number, txId: number, categoryId: number): boolean {
  const t = getTx(db, userId, txId);
  const cat = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .get();
  if (!t || !cat) return false;
  db.update(transactions).set({ categoryId, confirmedAt: Date.now() }).where(eq(transactions.id, txId)).run();
  logAction(db, userId, { action: 'categorize', payload: { txId, prevCategoryId: t.categoryId } });
  return true;
}

/**
 * Saves "always categorize <counterparty> as <category>" and applies it to every past
 * transaction with the same counterparty. Returns how many other transactions changed.
 */
export function createRuleFromTx(db: DB, userId: number, txId: number, categoryId: number): { ruleId: number; updated: number } | null {
  const t = getTx(db, userId, txId);
  if (!t) return null;
  const r = ruleFor(t);
  if (!r) return null;

  return db.transaction((tx) => {
    const ruleId = tx
      .insert(rules)
      .values({ userId, field: r.field, pattern: r.pattern, categoryId })
      .onConflictDoUpdate({ target: [rules.userId, rules.field, rules.pattern], set: { categoryId } })
      .returning({ id: rules.id })
      .get().id;

    const match =
      r.field === 'counterparty_name'
        ? sql`lower(trim(${transactions.counterpartyName})) = ${r.pattern}`
        : eq(transactions.counterpartyMaskedId, r.pattern);
    const affected = tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), match, sql`coalesce(${transactions.categoryId}, -1) != ${categoryId}`))
      .all();
    if (affected.length) {
      tx.update(transactions)
        .set({ categoryId })
        .where(inArray(transactions.id, affected.map((a) => a.id)))
        .run();
    }
    tx.insert(actionLog)
      .values({
        userId,
        action: 'rule',
        payload: { ruleId, changes: affected.map((a) => ({ txId: a.id, prevCategoryId: a.categoryId })) },
      })
      .run();
    return { ruleId, updated: affected.filter((a) => a.id !== txId).length };
  });
}

export function softDelete(db: DB, userId: number, txId: number): boolean {
  const res = db
    .update(transactions)
    .set({ deletedAt: Date.now() })
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .run();
  if (res.changes) logAction(db, userId, { action: 'delete', payload: { txId } });
  return res.changes > 0;
}

export function restore(db: DB, userId: number, txId: number): boolean {
  return (
    db
      .update(transactions)
      .set({ deletedAt: null })
      .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
      .run().changes > 0
  );
}

export type EditableField = 'amount' | 'counterpartyName' | 'note';

/** "#family #loan paid back" → note "paid back", tags ["family","loan"] */
export function splitNoteTags(input: string): { note: string | null; tags: string[] } {
  const tags = [...input.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]!.toLowerCase());
  const note = input.replace(/#[\p{L}\p{N}_-]+/gu, '').replace(/\s+/g, ' ').trim();
  return { note: note || null, tags: [...new Set(tags)] };
}

export function editTx(db: DB, userId: number, txId: number, field: EditableField, value: string | number): boolean {
  const t = getTx(db, userId, txId);
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
    case 'note': {
      prev = { note: t.note, tags: t.tags };
      set = splitNoteTags(String(value));
      break;
    }
  }
  db.update(transactions).set({ ...set, confirmedAt: Date.now() }).where(eq(transactions.id, txId)).run();
  logAction(db, userId, { action: 'edit', payload: { txId, field, prev } });
  return true;
}

// ---------- undo ----------

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Reverts the most recent not-yet-undone action within 24h. Returns a short description. */
export function undoLast(db: DB, userId: number, now = Date.now()): string | null {
  const last = db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.userId, userId), isNull(actionLog.undoneAt), sql`${actionLog.createdAt} >= ${now - UNDO_WINDOW_MS}`))
    .orderBy(desc(actionLog.id))
    .get();
  if (!last) return null;

  const p = last.payload as Record<string, any>;
  let desc_: string;
  db.transaction((tx) => {
    const own = (id: number) => and(eq(transactions.id, id), eq(transactions.userId, userId));
    switch (last.action) {
      case 'ingest': {
        const txIds = p.txIds as number[];
        const rawIds = p.rawIds as number[];
        if (txIds.length) tx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, txIds))).run();
        if (rawIds.length) tx.delete(rawMessages).where(and(eq(rawMessages.userId, userId), inArray(rawMessages.id, rawIds))).run();
        desc_ = `removed ${txIds.length} imported transaction${txIds.length === 1 ? '' : 's'}`;
        break;
      }
      case 'delete':
        tx.update(transactions).set({ deletedAt: null }).where(own(p.txId)).run();
        desc_ = 'restored the deleted transaction';
        break;
      case 'categorize':
        tx.update(transactions).set({ categoryId: p.prevCategoryId }).where(own(p.txId)).run();
        desc_ = 'reverted the category change';
        break;
      case 'rule':
        for (const c of p.changes as Array<{ txId: number; prevCategoryId: number | null }>) {
          tx.update(transactions).set({ categoryId: c.prevCategoryId }).where(own(c.txId)).run();
        }
        tx.delete(rules).where(and(eq(rules.id, p.ruleId), eq(rules.userId, userId))).run();
        desc_ = 'removed the categorization rule';
        break;
      case 'edit': {
        const set =
          p.field === 'note' ? { note: p.prev?.note ?? null, tags: p.prev?.tags ?? [] } : { [p.field]: p.prev };
        tx.update(transactions).set(set).where(own(p.txId)).run();
        desc_ = 'reverted the edit';
        break;
      }
      default:
        desc_ = 'nothing';
    }
    tx.update(actionLog).set({ undoneAt: now }).where(eq(actionLog.id, last.id)).run();
  });
  return desc_!;
}
