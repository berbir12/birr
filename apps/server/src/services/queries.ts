/** Read models for the Mini App: transaction list/detail and the Home summary. */
import { biggestChange, daysLeftInMonth, monthOf, previousMonth, safeToSpendToday, totals, type SummaryTx } from '@birr/core';
import { tidyName, type SummaryDto, type TxDetail, type TxFilters, type TxListItem, type TxPage } from '@birr/shared';
import { and, desc, eq, gte, ilike, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { accounts, budgets, categories, transactions } from '../db/schema.js';
import { reviewCount } from './ingest.js';
import { getTx } from './transactions.js';

const listColumns = {
  id: transactions.id,
  occurredAt: transactions.occurredAt,
  occurredAtEstimated: transactions.occurredAtEstimated,
  direction: transactions.direction,
  kind: transactions.kind,
  amount: transactions.amount,
  fee: transactions.fee,
  vat: transactions.vat,
  otherCharges: transactions.otherCharges,
  counterpartyName: transactions.counterpartyName,
  categoryId: transactions.categoryId,
  categoryKey: categories.key,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  categoryIsSpending: categories.isSpending,
  accountId: transactions.accountId,
  accountName: accounts.name,
  transferGroupId: transactions.transferGroupId,
  reconciliation: transactions.reconciliation,
  note: transactions.note,
  tags: transactions.tags,
  confirmedAt: transactions.confirmedAt,
};

type ListRow = { [K in keyof typeof listColumns]: (typeof listColumns)[K]['_']['data'] | null } & {
  id: number;
  occurredAt: number;
  amount: number;
};

function toItem(r: ListRow): TxListItem {
  return {
    id: r.id,
    occurredAt: r.occurredAt,
    occurredAtEstimated: Boolean(r.occurredAtEstimated),
    direction: r.direction as 'in' | 'out',
    kind: r.kind as string,
    amount: r.amount,
    charges: (r.fee ?? 0) + (r.vat ?? 0) + (r.otherCharges ?? 0),
    counterparty: r.counterpartyName ? tidyName(r.counterpartyName) : null,
    categoryId: r.categoryId,
    categoryKey: r.categoryKey,
    categoryName: r.categoryName,
    categoryIcon: r.categoryIcon,
    accountId: r.accountId as number,
    accountName: r.accountName as string,
    internal: r.transferGroupId !== null,
    reconciliation: (r.reconciliation ?? 'unknown') as TxListItem['reconciliation'],
    note: r.note,
    tags: (r.tags as string[] | null) ?? [],
    confirmed: r.confirmedAt !== null,
  };
}

function baseQuery(db: DB) {
  return db
    .select(listColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId));
}

/** Cursor = "<occurredAt>.<id>" of the last item (keyset pagination, newest first). */
export function encodeCursor(t: { occurredAt: number; id: number }): string {
  return `${t.occurredAt}.${t.id}`;
}
function decodeCursor(c: string | undefined): { at: number; id: number } | null {
  const m = c ? /^(\d+)\.(\d+)$/.exec(c) : null;
  return m ? { at: Number(m[1]), id: Number(m[2]) } : null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listTransactions(
  db: DB,
  userId: number,
  f: TxFilters & { cursor?: string; limit?: number },
): Promise<TxPage> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const where: SQL[] = [eq(transactions.userId, userId), isNull(transactions.deletedAt)];
  if (f.accountId) where.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId) where.push(eq(transactions.categoryId, f.categoryId));
  if (f.personId) where.push(eq(transactions.personId, f.personId));
  if (f.direction) where.push(eq(transactions.direction, f.direction));
  if (f.kind) where.push(eq(transactions.kind, f.kind));
  if (f.reconciliation) where.push(eq(transactions.reconciliation, f.reconciliation));
  if (f.minAmount !== undefined) where.push(gte(transactions.amount, f.minAmount));
  if (f.maxAmount !== undefined) where.push(lte(transactions.amount, f.maxAmount));
  if (f.from !== undefined) where.push(gte(transactions.occurredAt, f.from));
  if (f.to !== undefined) where.push(lt(transactions.occurredAt, f.to));
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const asAmount = /^[\d,]+(\.\d{1,2})?$/.test(q) ? Math.round(Number(q.replace(/,/g, '')) * 100) : null;
    where.push(
      or(
        ilike(transactions.counterpartyName, like),
        ilike(transactions.note, like),
        sql`${transactions.tags}::text ilike ${like}`,
        ilike(categories.name, like),
        ilike(accounts.name, like),
        ...(asAmount !== null ? [eq(transactions.amount, asAmount)] : []),
      )!,
    );
  }
  const cursor = decodeCursor(f.cursor);
  if (cursor) {
    where.push(
      or(lt(transactions.occurredAt, cursor.at), and(eq(transactions.occurredAt, cursor.at), lt(transactions.id, cursor.id)))!,
    );
  }
  const rows = await baseQuery(db)
    .where(and(...where))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit) as unknown as ListRow[];
  return {
    items: page.map(toItem),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
}

export async function txDetail(db: DB, userId: number, txId: number): Promise<TxDetail | null> {
  const t = await getTx(db, userId, txId);
  if (!t) return null;
  return {
    id: t.id,
    occurredAt: t.occurredAt,
    occurredAtEstimated: t.occurredAtEstimated,
    direction: t.direction,
    kind: t.kind,
    amount: t.amount,
    charges: t.fee + t.vat + t.otherCharges,
    counterparty: t.counterpartyName ? tidyName(t.counterpartyName) : null,
    categoryId: t.categoryId,
    categoryKey: t.categoryKey,
    categoryName: t.categoryName,
    categoryIcon: t.categoryIcon,
    accountId: t.accountId,
    accountName: t.accountName,
    internal: t.transferGroupId !== null,
    reconciliation: t.reconciliation,
    note: t.note,
    tags: t.tags,
    confirmed: t.confirmedAt !== null,
    fee: t.fee,
    vat: t.vat,
    otherCharges: t.otherCharges,
    balanceAfter: t.balanceAfter,
    counterpartyMaskedId: t.counterpartyMaskedId,
    reference: t.reference,
    receiptUrl: t.receiptUrl,
    reconciliationDelta: t.reconciliationDelta,
    transferPeerAccount: t.transferPeerAccount,
    channel: t.channel,
    deleted: t.deletedAt !== null,
  };
}

async function periodTxs(db: DB, userId: number, from: number, to: number): Promise<SummaryTx[]> {
  const rows = await baseQuery(db).where(
    and(eq(transactions.userId, userId), isNull(transactions.deletedAt), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)),
  );
  return rows.map((r) => ({
    direction: r.direction,
    amount: r.amount,
    fee: r.fee,
    vat: r.vat,
    otherCharges: r.otherCharges,
    categoryKey: r.categoryKey,
    categoryIsSpending: r.categoryIsSpending,
    internal: r.transferGroupId !== null,
  }));
}

export async function summary(db: DB, userId: number, tz: string, now = Date.now()): Promise<SummaryDto> {
  const month = monthOf(now, tz);
  const prev = previousMonth(month, tz);
  // Compare like with like: this month so far vs the same number of days of last month.
  const elapsed = now - month.start;
  const prevSameSpan = Math.min(prev.start + elapsed, prev.end);

  // Sequential on purpose. On Vercel the client holds one connection; parallel queries get pipelined
  // on it, and Supabase's transaction pooler (Supavisor) never answers a pipelined batch — the
  // request hung until the 30 s function timeout. Each query here takes a few ms.
  const accts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.archived, false)))
    .orderBy(accounts.id);
  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
  const cur = await periodTxs(db, userId, month.start, month.end);
  const before = await periodTxs(db, userId, prev.start, prevSameSpan);
  const budgetRows = await db.select().from(budgets).where(eq(budgets.userId, userId));
  const recent = await listTransactions(db, userId, { limit: 8 });
  const reviews = await reviewCount(db, userId);
  const gaps = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.reconciliation, 'gap'), isNull(transactions.deletedAt)));

  const t = totals(cur);
  const p = totals(before);
  const change = biggestChange(t.byCategory, p.byCategory);
  const catByKey = new Map(cats.map((c) => [c.key, c]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const budgetTotal = budgetRows.reduce((s, b) => s + b.amount, 0);
  const spentInBudgeted = budgetRows.reduce((s, b) => s + (t.byCategory[catById.get(b.categoryId)?.key ?? ''] ?? 0), 0);

  return {
    month: { key: month.key, start: month.start, end: month.end },
    accounts: accts.map((a) => ({ id: a.id, type: a.type, name: a.name, maskedId: a.maskedId, balance: a.balance, balanceAt: a.balanceAt })),
    total: accts.reduce((s, a) => s + a.balance, 0),
    monthIn: t.in,
    monthOut: t.out,
    monthFees: t.fees,
    safeToSpendToday: safeToSpendToday(budgetTotal, spentInBudgeted, daysLeftInMonth(now, tz)),
    insight: change
      ? { categoryKey: change.categoryKey, categoryName: catByKey.get(change.categoryKey)?.name ?? change.categoryKey, pct: change.pct }
      : null,
    recent: recent.items,
    reviewCount: reviews,
    gapCount: gaps[0]?.n ?? 0,
  };
}

