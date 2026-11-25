/** Phase 6 read/write models: analytics, budgets (+ alerts), goals, people & debts, recurring. */
import {
  budgetAlertDue,
  budgetStatus,
  cashflow,
  dailySpending,
  dayKey,
  debtBalances,
  detectRecurring,
  feeSummary,
  goalProgress,
  monthOf,
  monthPeriod,
  previousMonth,
  spendOf,
  topCounterparties,
  totals,
  zonedTime,
  localParts,
  type PlanTx,
} from '@birr/core';
import {
  formatEtb,
  tidyName,
  type AnalyticsDto,
  type AnalyticsRange,
  type BudgetsDto,
  type DebtDto,
  type GoalDto,
  type PersonDetailDto,
  type PersonDto,
  type RecurringDto,
} from '@birr/shared';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { budgets, categories, debts, goals, people, recurringItems, transactions } from '../db/schema.js';
import { listTransactions } from './queries.js';
import type { User } from './users.js';

// ---------------------------------------------------------------- loading

export async function planTxs(db: DB, userId: number, from: number, to: number): Promise<PlanTx[]> {
  const rows = await db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      direction: transactions.direction,
      kind: transactions.kind,
      amount: transactions.amount,
      fee: transactions.fee,
      vat: transactions.vat,
      otherCharges: transactions.otherCharges,
      source: transactions.source,
      counterpartyName: transactions.counterpartyName,
      personId: transactions.personId,
      categoryKey: categories.key,
      categoryIsSpending: categories.isSpending,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)));
  return rows.map(({ transferGroupId, ...r }) => ({ ...r, internal: transferGroupId !== null }));
}

// ---------------------------------------------------------------- analytics

export function rangeBounds(range: AnalyticsRange, now: number, tz: string): { from: number; to: number } {
  const m = monthOf(now, tz);
  switch (range) {
    case 'month':
      return { from: m.start, to: m.end };
    case 'last-month': {
      const p = previousMonth(m, tz);
      return { from: p.start, to: p.end };
    }
    case '3m': {
      const { year, month } = localParts(now, tz);
      const startMonth = month - 2 <= 0 ? monthPeriod(year - 1, month + 10, tz) : monthPeriod(year, month - 2, tz);
      return { from: startMonth.start, to: m.end };
    }
    case 'year': {
      const { year } = localParts(now, tz);
      return { from: zonedTime(tz, year, 1, 1), to: zonedTime(tz, year + 1, 1, 1) };
    }
  }
}

export async function analytics(db: DB, user: User, range: AnalyticsRange, now = Date.now()): Promise<AnalyticsDto> {
  const tz = user.timezone;
  const { from, to } = rangeBounds(range, now, tz);
  // Six months for the cash-flow chart, the year for the fee tracker; load the widest span once.
  const months: Array<{ key: string; start: number; end: number }> = [];
  let p = monthOf(now, tz);
  for (let i = 0; i < 6; i++) {
    months.unshift({ key: p.key, start: p.start, end: p.end });
    p = previousMonth(p, tz);
  }
  const { year } = localParts(now, tz);
  const yearStart = zonedTime(tz, year, 1, 1);
  const loadFrom = Math.min(from, months[0]!.start, yearStart);
  const loadTo = Math.max(to, months.at(-1)!.end);
  const all = await planTxs(db, user.id, loadFrom, loadTo);
  const inRange = all.filter((t) => t.occurredAt >= from && t.occurredAt < to);

  const t = totals(
    inRange.map((x) => ({ ...x, categoryKey: x.categoryKey, categoryIsSpending: x.categoryIsSpending })),
  );
  const cats = await db.select().from(categories).where(eq(categories.userId, user.id));
  const catByKey = new Map(cats.map((c) => [c.key, c]));
  const byCategory = Object.entries(t.byCategory)
    .filter(([, v]) => v > 0)
    .map(([key, amount]) => ({ categoryKey: key, name: catByKey.get(key)?.name ?? key, icon: catByKey.get(key)?.icon ?? null, amount }))
    .sort((a, b) => b.amount - a.amount);

  const ppl = await db.select({ id: people.id, name: people.displayName }).from(people).where(eq(people.userId, user.id));
  const personName = new Map(ppl.map((x) => [x.id, x.name]));
  const fees = feeSummary(inRange);
  const yearFees = feeSummary(all.filter((x) => x.occurredAt >= yearStart));

  return {
    range,
    from,
    to,
    totalOut: t.out,
    totalIn: t.in,
    byCategory,
    cashflow: cashflow(all, months).map((c, i) => ({ ...c, start: months[i]!.start })),
    daily: dailySpending(inRange, (ms) => dayKey(ms, tz)),
    topPeople: topCounterparties(inRange, 8).map((c) => ({
      key: c.key,
      name: c.personId !== null ? (personName.get(c.personId) ?? tidyName(c.name)) : tidyName(c.name),
      personId: c.personId,
      out: c.out,
      in: c.in,
      count: c.count,
    })),
    fees: { ...fees, yearTotal: yearFees.total },
  };
}

// ---------------------------------------------------------------- budgets

async function monthSpendByCategory(db: DB, user: User, now: number) {
  const m = monthOf(now, user.timezone);
  const txs = await planTxs(db, user.id, m.start, m.end);
  const spent: Record<string, number> = {};
  for (const x of txs) {
    if (x.direction !== 'out') continue;
    const s = spendOf(x) - (x.fee + x.vat + x.otherCharges); // budgets track the category amount; fees are their own category
    if (s > 0) spent[x.categoryKey ?? 'other'] = (spent[x.categoryKey ?? 'other'] ?? 0) + s;
    const c = x.fee + x.vat + x.otherCharges;
    if (c) spent.fees = (spent.fees ?? 0) + c;
  }
  return { month: m, spent };
}

export async function listBudgets(db: DB, user: User, now = Date.now()): Promise<BudgetsDto> {
  const { month, spent } = await monthSpendByCategory(db, user, now);
  const rows = await db
    .select({ b: budgets, key: categories.key, name: categories.name, icon: categories.icon })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(eq(budgets.userId, user.id));
  const elapsed = Math.min(1, Math.max(0, (now - month.start) / (month.end - month.start)));
  const list = rows
    .map((r) => {
      const s = budgetStatus(r.b.amount, spent[r.key] ?? 0, elapsed);
      return { categoryId: r.b.categoryId, categoryKey: r.key, name: r.name, icon: r.icon, ...s };
    })
    .sort((a, b) => b.pct - a.pct);
  const daysLeft = Math.max(1, Math.ceil((month.end - now) / 86400_000));
  return {
    month: { key: month.key, start: month.start, end: month.end, daysLeft },
    budgets: list,
    total: { amount: list.reduce((s, b) => s + b.amount, 0), spent: list.reduce((s, b) => s + b.spent, 0) },
  };
}

export async function setBudget(db: DB, userId: number, categoryId: number, amount: number): Promise<boolean> {
  const [cat] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
  if (!cat) return false;
  await db
    .insert(budgets)
    .values({ userId, categoryId, amount })
    .onConflictDoUpdate({ target: [budgets.userId, budgets.categoryId], set: { amount } });
  return true;
}

export async function deleteBudget(db: DB, userId: number, categoryId: number): Promise<void> {
  await db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId)));
}

/**
 * Budget alerts to send now (80% and 100%, once per month each). Marks them as sent.
 * Called after new transactions arrive by paste or forwarding.
 */
export async function dueBudgetAlerts(db: DB, user: User, now = Date.now()): Promise<string[]> {
  const { month, spent } = await monthSpendByCategory(db, user, now);
  const rows = await db
    .select({ b: budgets, name: categories.name, icon: categories.icon, key: categories.key })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(eq(budgets.userId, user.id));
  const daysLeft = Math.max(1, Math.ceil((month.end - now) / 86400_000));
  const messages: string[] = [];
  for (const r of rows) {
    const s = budgetStatus(r.b.amount, spent[r.key] ?? 0, 1);
    const due = budgetAlertDue(s.pct, month.key, r.b);
    if (!due) continue;
    await db
      .update(budgets)
      .set(due === 100 ? { alert100Period: month.key, alert80Period: month.key } : { alert80Period: month.key })
      .where(eq(budgets.id, r.b.id));
    messages.push(
      due === 100
        ? `🔴 <b>${r.name}</b> is over budget: ${formatEtb(s.spent)} of ${formatEtb(s.amount)} (${s.pct}%).`
        : `🟠 <b>${r.name}</b>: ${s.pct}% of your ${formatEtb(s.amount)} budget used, ${formatEtb(s.remaining)} left for ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    );
  }
  return messages;
}

// ---------------------------------------------------------------- goals

function toGoalDto(g: typeof goals.$inferSelect, now: number): GoalDto {
  const p = goalProgress(g.target, g.saved, g.deadline, now);
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    target: g.target,
    saved: g.saved,
    deadline: g.deadline,
    achievedAt: g.achievedAt,
    pct: p.pct,
    remaining: p.remaining,
    weeksLeft: p.weeksLeft,
    suggestedWeekly: p.suggestedWeekly,
    overdue: p.overdue,
  };
}

export async function listGoals(db: DB, userId: number, now = Date.now()): Promise<GoalDto[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.archived, false)))
    .orderBy(goals.createdAt);
  return rows.map((g) => toGoalDto(g, now));
}

export async function createGoal(
  db: DB,
  userId: number,
  v: { name: string; emoji?: string | null; target: number; deadline?: number | null; saved?: number },
): Promise<GoalDto> {
  const [g] = await db
    .insert(goals)
    .values({ userId, name: v.name, emoji: v.emoji ?? null, target: v.target, deadline: v.deadline ?? null, saved: v.saved ?? 0 })
    .returning();
  return toGoalDto(g!, Date.now());
}

export async function updateGoal(
  db: DB,
  userId: number,
  id: number,
  patch: Partial<{ name: string; emoji: string | null; target: number; deadline: number | null; archived: boolean }>,
): Promise<GoalDto | null> {
  const [g] = await db.update(goals).set(patch).where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();
  return g ? toGoalDto(g, Date.now()) : null;
}

/** Adds (or with a negative amount, withdraws) savings; marks the goal achieved when reached. */
export async function contributeGoal(db: DB, userId: number, id: number, amount: number, now = Date.now()): Promise<GoalDto | null> {
  const [g] = await db
    .update(goals)
    .set({ saved: sql`greatest(0, ${goals.saved} + ${amount})` })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning();
  if (!g) return null;
  if (g.saved >= g.target && !g.achievedAt) {
    const [done] = await db.update(goals).set({ achievedAt: now }).where(eq(goals.id, id)).returning();
    return toGoalDto(done!, now);
  }
  return toGoalDto(g, now);
}

// ---------------------------------------------------------------- people & debts

async function debtRows(db: DB, userId: number, personId?: number): Promise<DebtDto[]> {
  const rows = await db
    .select({ d: debts, name: people.displayName })
    .from(debts)
    .innerJoin(people, eq(people.id, debts.personId))
    .where(and(eq(debts.userId, userId), ...(personId ? [eq(debts.personId, personId)] : [])))
    .orderBy(desc(debts.createdAt));
  return rows.map(({ d, name }) => ({
    id: d.id,
    personId: d.personId,
    personName: name,
    direction: d.direction,
    amount: d.amount,
    note: d.note,
    dueAt: d.dueAt,
    createdAt: d.createdAt,
    settledAt: d.settledAt,
    settledTransactionId: d.settledTransactionId,
  }));
}

export async function listPeople(db: DB, userId: number): Promise<PersonDto[]> {
  const ppl = await db.select().from(people).where(eq(people.userId, userId));
  const stats = await db
    .select({
      personId: transactions.personId,
      out: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::bigint`,
      in: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::bigint`,
      count: sql<number>`count(*)::int`,
      lastAt: sql<number>`max(${transactions.occurredAt})`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), sql`${transactions.personId} is not null`))
    .groupBy(transactions.personId);
  const byId = new Map(stats.map((s) => [s.personId!, s]));
  const balances = debtBalances(await debtRows(db, userId));
  return ppl
    .map((p) => {
      const s = byId.get(p.id);
      return {
        id: p.id,
        name: p.displayName,
        maskedId: p.maskedId,
        out: Number(s?.out ?? 0),
        in: Number(s?.in ?? 0),
        count: s?.count ?? 0,
        lastAt: s?.lastAt ? Number(s.lastAt) : null,
        balance: balances.get(p.id) ?? 0,
      };
    })
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || b.out + b.in - (a.out + a.in));
}

export async function personDetail(db: DB, userId: number, personId: number): Promise<PersonDetailDto | null> {
  const list = await listPeople(db, userId);
  const person = list.find((p) => p.id === personId);
  if (!person) return null;
  return {
    person,
    debts: await debtRows(db, userId, personId),
    recent: (await listTransactions(db, userId, { personId, limit: 30 })).items,
  };
}

export async function createPerson(db: DB, userId: number, name: string): Promise<number> {
  const display = tidyName(name.trim());
  const [existing] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.userId, userId), sql`lower(${people.displayName}) = ${display.toLowerCase()}`))
    .limit(1);
  if (existing) return existing.id;
  const [p] = await db.insert(people).values({ userId, displayName: display }).returning({ id: people.id });
  return p!.id;
}

export async function createDebt(
  db: DB,
  userId: number,
  v: { personId?: number; personName?: string; direction: 'lent' | 'borrowed'; amount: number; note?: string | null; dueAt?: number | null; originTransactionId?: number | null },
): Promise<DebtDto | null> {
  let personId = v.personId ?? null;
  if (personId !== null) {
    const [own] = await db.select({ id: people.id }).from(people).where(and(eq(people.id, personId), eq(people.userId, userId)));
    if (!own) return null;
  } else if (v.personName?.trim()) {
    personId = await createPerson(db, userId, v.personName);
  } else return null;
  const [d] = await db
    .insert(debts)
    .values({ userId, personId, direction: v.direction, amount: v.amount, note: v.note ?? null, dueAt: v.dueAt ?? null, originTransactionId: v.originTransactionId ?? null })
    .returning({ id: debts.id });
  return (await debtRows(db, userId)).find((x) => x.id === d!.id) ?? null;
}

/**
 * Transactions that could settle a debt: with the same person (or same name), in the repaying
 * direction (lent → money in; borrowed → money out), after the debt, closest amount first.
 */
export async function settleCandidates(db: DB, userId: number, debtId: number) {
  const [d] = await db.select().from(debts).where(and(eq(debts.id, debtId), eq(debts.userId, userId)));
  if (!d) return null;
  const [p] = await db.select().from(people).where(eq(people.id, d.personId));
  const page = await listTransactions(db, userId, { direction: d.direction === 'lent' ? 'in' : 'out', from: d.createdAt - 86400_000, limit: 200 });
  const name = p?.displayName.toLowerCase() ?? '';
  const ids = new Set(
    (
      await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.personId, d.personId)))
    ).map((r) => r.id),
  );
  return page.items
    .filter((t) => ids.has(t.id) || (t.counterparty ?? '').toLowerCase() === name)
    .sort((a, b) => Math.abs(a.amount - d.amount) - Math.abs(b.amount - d.amount))
    .slice(0, 10);
}

export async function settleDebt(db: DB, userId: number, debtId: number, transactionId: number | null, now = Date.now()): Promise<boolean> {
  if (transactionId !== null) {
    const [own] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
    if (!own) return false;
  }
  const res = await db
    .update(debts)
    .set({ settledAt: now, settledTransactionId: transactionId })
    .where(and(eq(debts.id, debtId), eq(debts.userId, userId)))
    .returning({ id: debts.id });
  return res.length > 0;
}

export async function reopenDebt(db: DB, userId: number, debtId: number): Promise<boolean> {
  const res = await db
    .update(debts)
    .set({ settledAt: null, settledTransactionId: null })
    .where(and(eq(debts.id, debtId), eq(debts.userId, userId)))
    .returning({ id: debts.id });
  return res.length > 0;
}

export async function deleteDebt(db: DB, userId: number, debtId: number): Promise<boolean> {
  const res = await db.delete(debts).where(and(eq(debts.id, debtId), eq(debts.userId, userId))).returning({ id: debts.id });
  return res.length > 0;
}

// ---------------------------------------------------------------- recurring

/** Detects recurring payments over the last ~6 months and merges them with saved statuses. */
export async function listRecurring(db: DB, user: User, now = Date.now()): Promise<{ items: RecurringDto[]; monthlyTotal: number }> {
  const txs = await planTxs(db, user.id, now - 190 * 86400_000, now + 86400_000);
  const found = detectRecurring(txs, now);
  const cats = await db.select({ id: categories.id, key: categories.key }).from(categories).where(eq(categories.userId, user.id));
  const catId = new Map(cats.map((c) => [c.key, c.id]));
  for (const f of found) {
    const values = {
      userId: user.id,
      label: tidyName(f.label),
      matchKey: f.matchKey,
      categoryId: f.categoryKey ? (catId.get(f.categoryKey) ?? null) : null,
      avgAmount: f.avgAmount,
      intervalDays: f.intervalDays,
      lastSeenAt: f.lastSeenAt,
      nextExpectedAt: f.nextExpectedAt,
    };
    // Keep the user's confirm/dismiss decision; refresh everything else.
    const { userId: _u, matchKey: _m, ...refresh } = values;
    await db.insert(recurringItems).values(values).onConflictDoUpdate({ target: [recurringItems.userId, recurringItems.matchKey], set: refresh });
  }
  const keys = found.map((f) => f.matchKey);
  const rows = keys.length
    ? await db
        .select({ r: recurringItems, key: categories.key })
        .from(recurringItems)
        .leftJoin(categories, eq(categories.id, recurringItems.categoryId))
        .where(and(eq(recurringItems.userId, user.id), inArray(recurringItems.matchKey, keys)))
    : [];
  const monthlyOf = new Map(found.map((f) => [f.matchKey, f.monthlyAmount]));
  const items = rows
    .filter(({ r }) => r.status !== 'dismissed')
    .map(({ r, key }) => ({
      id: r.id,
      label: r.label,
      categoryKey: key,
      intervalDays: r.intervalDays,
      avgAmount: r.avgAmount,
      monthlyAmount: monthlyOf.get(r.matchKey) ?? r.avgAmount,
      lastSeenAt: r.lastSeenAt,
      nextExpectedAt: r.nextExpectedAt,
      status: r.status as 'detected' | 'confirmed',
    }))
    .sort((a, b) => a.nextExpectedAt - b.nextExpectedAt);
  return { items, monthlyTotal: items.reduce((s, i) => s + i.monthlyAmount, 0) };
}

export async function setRecurringStatus(db: DB, userId: number, id: number, status: 'confirmed' | 'dismissed'): Promise<boolean> {
  const res = await db
    .update(recurringItems)
    .set({ status })
    .where(and(eq(recurringItems.id, id), eq(recurringItems.userId, userId)))
    .returning({ id: recurringItems.id });
  return res.length > 0;
}
