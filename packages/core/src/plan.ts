/**
 * Phase 6 logic: analytics aggregations, budget states/alerts, goals, recurring detection, debts.
 * Pure functions; the server loads rows and the Mini App renders the results.
 */
import { charges } from './summary.js';

// ---------------------------------------------------------------- shared tx shape

export interface PlanTx {
  id: number;
  occurredAt: number;
  direction: 'in' | 'out';
  kind: string;
  amount: number;
  fee: number;
  vat: number;
  otherCharges: number;
  source: string;
  counterpartyName: string | null;
  personId: number | null;
  categoryKey: string | null;
  categoryIsSpending: boolean | null;
  internal: boolean;
}

/** Moving my own money (linked transfers, the "Transfers" category) is neither spending nor income. */
const ownMove = (t: Pick<PlanTx, 'internal' | 'categoryKey'>) => t.internal || t.categoryKey === 'transfers';

/** What a transaction costs me: amount (unless own move / non-spending category) + all charges. */
export function spendOf(t: PlanTx): number {
  if (t.direction !== 'out') return 0;
  const base = ownMove(t) || t.categoryIsSpending === false ? 0 : t.amount;
  return base + charges(t);
}

export function incomeOf(t: PlanTx): number {
  return t.direction === 'in' && !ownMove(t) ? t.amount : 0;
}

// ---------------------------------------------------------------- analytics

/** Spending per local day ("2026-11-24" → cents). */
export function dailySpending(txs: readonly PlanTx[], dayKeyOf: (ms: number) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) {
    const s = spendOf(t);
    if (s) out[dayKeyOf(t.occurredAt)] = (out[dayKeyOf(t.occurredAt)] ?? 0) + s;
  }
  return out;
}

/** In/out per bucket (e.g. per month), in the order of `buckets`. */
export function cashflow(
  txs: readonly PlanTx[],
  buckets: ReadonlyArray<{ key: string; start: number; end: number }>,
): Array<{ key: string; in: number; out: number }> {
  return buckets.map((b) => {
    let i = 0;
    let o = 0;
    for (const t of txs) {
      if (t.occurredAt < b.start || t.occurredAt >= b.end) continue;
      i += incomeOf(t);
      o += spendOf(t);
    }
    return { key: b.key, in: i, out: o };
  });
}

export interface CounterpartyTotal {
  key: string;
  name: string;
  personId: number | null;
  out: number;
  in: number;
  count: number;
  lastAt: number;
}

/** Who I pay and get paid by most. Own moves, agents and banks are excluded. */
export function topCounterparties(txs: readonly PlanTx[], limit = 10): CounterpartyTotal[] {
  const by = new Map<string, CounterpartyTotal>();
  for (const t of txs) {
    if (!t.counterpartyName || ownMove(t)) continue;
    if (t.kind !== 'transfer_out' && t.kind !== 'transfer_in' && t.kind !== 'merchant_payment') continue;
    const key = t.personId !== null ? `p${t.personId}` : `n:${t.counterpartyName.trim().toLowerCase()}`;
    const cur = by.get(key) ?? { key, name: t.counterpartyName, personId: t.personId, out: 0, in: 0, count: 0, lastAt: 0 };
    if (t.direction === 'out') cur.out += t.amount;
    else cur.in += t.amount;
    cur.count++;
    cur.lastAt = Math.max(cur.lastAt, t.occurredAt);
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => b.out + b.in - (a.out + a.in)).slice(0, limit);
}

export interface FeeSummary {
  total: number;
  fee: number;
  vat: number;
  other: number;
  bySource: Record<string, number>;
  count: number;
}

/** Service fees, VAT and levies paid. */
export function feeSummary(txs: readonly PlanTx[]): FeeSummary {
  const s: FeeSummary = { total: 0, fee: 0, vat: 0, other: 0, bySource: {}, count: 0 };
  for (const t of txs) {
    const c = charges(t);
    if (!c) continue;
    s.total += c;
    s.fee += t.fee;
    s.vat += t.vat;
    s.other += t.otherCharges;
    s.bySource[t.source] = (s.bySource[t.source] ?? 0) + c;
    s.count++;
  }
  return s;
}

// ---------------------------------------------------------------- budgets

export type BudgetState = 'ok' | 'warning' | 'over';

export interface BudgetStatus {
  spent: number;
  amount: number;
  remaining: number;
  /** 0–∞, rounded down to a whole percent. */
  pct: number;
  state: BudgetState;
  /** Month-end spend at the current pace (null early in the month, when it's noise). */
  projected: number | null;
}

export const BUDGET_WARN_PCT = 80;

export function budgetStatus(amount: number, spent: number, monthFractionElapsed: number): BudgetStatus {
  const pct = amount > 0 ? Math.floor((spent / amount) * 100) : 0;
  return {
    spent,
    amount,
    remaining: amount - spent,
    pct,
    state: pct >= 100 ? 'over' : pct >= BUDGET_WARN_PCT ? 'warning' : 'ok',
    projected: monthFractionElapsed >= 0.15 ? Math.round(spent / monthFractionElapsed) : null,
  };
}

/**
 * Which alert (if any) to send now. Each threshold fires at most once per period; crossing 100%
 * directly (one big payment) sends only the 100% alert and marks 80% as done too.
 */
export function budgetAlertDue(
  pct: number,
  periodKey: string,
  sent: { alert80Period: string | null; alert100Period: string | null },
): 80 | 100 | null {
  if (pct >= 100 && sent.alert100Period !== periodKey) return 100;
  if (pct >= BUDGET_WARN_PCT && pct < 100 && sent.alert80Period !== periodKey) return 80;
  return null;
}

// ---------------------------------------------------------------- goals

export interface GoalProgress {
  pct: number;
  remaining: number;
  achieved: boolean;
  /** Whole weeks until the deadline (≥ 1), or null without a deadline. */
  weeksLeft: number | null;
  /** What to put aside each week to make the deadline, rounded up to a whole birr. */
  suggestedWeekly: number | null;
  overdue: boolean;
}

const WEEK = 7 * 86400_000;

export function goalProgress(target: number, saved: number, deadline: number | null, now: number): GoalProgress {
  const remaining = Math.max(0, target - saved);
  const achieved = saved >= target && target > 0;
  const pct = target > 0 ? Math.min(100, Math.floor((saved / target) * 100)) : 0;
  if (deadline === null) return { pct, remaining, achieved, weeksLeft: null, suggestedWeekly: null, overdue: false };
  const overdue = !achieved && deadline < now;
  const weeksLeft = Math.max(1, Math.ceil((deadline - now) / WEEK));
  const suggestedWeekly = achieved ? 0 : Math.ceil(remaining / weeksLeft / 100) * 100;
  return { pct, remaining, achieved, weeksLeft, suggestedWeekly, overdue };
}

// ---------------------------------------------------------------- recurring

export interface RecurringCandidate {
  matchKey: string;
  label: string;
  categoryKey: string | null;
  intervalDays: 7 | 14 | 30;
  avgAmount: number;
  count: number;
  lastSeenAt: number;
  nextExpectedAt: number;
  /** Normalised to a month. */
  monthlyAmount: number;
}

const PERIODS: Array<{ days: 7 | 14 | 30; min: number; max: number }> = [
  { days: 7, min: 6, max: 8.5 },
  { days: 14, min: 12.5, max: 16 },
  { days: 30, min: 26, max: 35 },
];
const DAY = 86400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Kinds that repeat on their own (no counterparty needed to group them). */
const KIND_GROUPS = new Set(['airtime', 'data_package', 'bill_payment']);

/**
 * Finds payments that repeat on a weekly, fortnightly or monthly rhythm with a stable amount:
 * rent, equb, subscriptions, data packages. Daily taxis don't qualify (too frequent), and family
 * support that varies a lot in amount doesn't either. A series that stopped (no payment for two
 * periods) is dropped.
 */
export function detectRecurring(txs: readonly PlanTx[], now: number, minCount = 3): RecurringCandidate[] {
  const groups = new Map<string, PlanTx[]>();
  for (const t of txs) {
    if (t.direction !== 'out' || ownMove(t)) continue;
    const key = t.counterpartyName
      ? `name:${t.counterpartyName.trim().toLowerCase()}`
      : KIND_GROUPS.has(t.kind)
        ? `kind:${t.kind}`
        : null;
    if (key) groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: RecurringCandidate[] = [];
  for (const [matchKey, list] of groups) {
    if (list.length < minCount) continue;
    const sorted = [...list].sort((a, b) => a.occurredAt - b.occurredAt);
    const gaps = sorted.slice(1).map((t, i) => (t.occurredAt - sorted[i]!.occurredAt) / DAY);
    const typical = median(gaps);
    const period = PERIODS.find((p) => typical >= p.min && typical <= p.max);
    if (!period) continue;
    const regular = gaps.filter((g) => g >= period.min && g <= period.max).length / gaps.length;
    if (regular < 0.7) continue;
    const amounts = sorted.map((t) => t.amount);
    const mid = median(amounts);
    const spread = median(amounts.map((a) => Math.abs(a - mid))) / mid;
    if (spread > 0.2) continue;
    const last = sorted.at(-1)!;
    if (now - last.occurredAt > 2 * period.days * DAY) continue; // stopped
    const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    out.push({
      matchKey,
      label: last.counterpartyName ?? last.kind,
      categoryKey: last.categoryKey,
      intervalDays: period.days,
      avgAmount: avg,
      count: sorted.length,
      lastSeenAt: last.occurredAt,
      nextExpectedAt: last.occurredAt + period.days * DAY,
      monthlyAmount: period.days === 30 ? avg : Math.round((avg * 365) / 12 / period.days),
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

// ---------------------------------------------------------------- debts

export interface DebtLike {
  personId: number;
  direction: 'lent' | 'borrowed';
  amount: number;
  settledAt: number | null;
}

/** Net open balance per person: > 0 they owe me, < 0 I owe them. */
export function debtBalances(debts: readonly DebtLike[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of debts) {
    if (d.settledAt !== null) continue;
    m.set(d.personId, (m.get(d.personId) ?? 0) + (d.direction === 'lent' ? d.amount : -d.amount));
  }
  return m;
}
