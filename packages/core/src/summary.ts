/**
 * Money totals with the rules that matter:
 *  - internal transfers (linked legs) are neither income nor spending;
 *  - "Transfers" (moving my own money: agent cash-in, wallet → own bank) is excluded too;
 *  - service fees, VAT and levies are always real spending, booked to "fees", even on transfers.
 */

export interface SummaryTx {
  direction: 'in' | 'out';
  amount: number;
  fee: number;
  vat: number;
  otherCharges: number;
  categoryKey: string | null;
  /** From the category: false for income/transfers. */
  categoryIsSpending: boolean | null;
  /** Linked internal transfer leg. */
  internal: boolean;
}

export interface Totals {
  in: number;
  /** Spending incl. fees. */
  out: number;
  fees: number;
  /** Spending per category key, fees under "fees". */
  byCategory: Record<string, number>;
}

export const charges = (t: Pick<SummaryTx, 'fee' | 'vat' | 'otherCharges'>) => t.fee + t.vat + t.otherCharges;

export function totals(txs: readonly SummaryTx[]): Totals {
  const out: Totals = { in: 0, out: 0, fees: 0, byCategory: {} };
  const add = (k: string, v: number) => (out.byCategory[k] = (out.byCategory[k] ?? 0) + v);
  for (const t of txs) {
    if (t.direction === 'in') {
      if (!t.internal && t.categoryKey !== 'transfers') out.in += t.amount;
      continue;
    }
    const c = charges(t);
    if (c) {
      out.fees += c;
      add('fees', c);
    }
    if (!t.internal && t.categoryIsSpending !== false) add(t.categoryKey ?? 'other', t.amount);
  }
  out.out = Object.values(out.byCategory).reduce((a, b) => a + b, 0);
  return out;
}

export interface SpendingInsight {
  categoryKey: string;
  current: number;
  previous: number;
  /** Rounded percent change, e.g. 34 or −20. */
  pct: number;
}

/**
 * The most notable category change between two comparable periods (e.g. this month so far vs the
 * same days last month). Ignores small categories and small absolute changes, so it doesn't shout
 * "+300% on airtime" over ETB 40.
 */
export function biggestChange(
  current: Record<string, number>,
  previous: Record<string, number>,
  opts: { minAmount?: number; minDelta?: number } = {},
): SpendingInsight | null {
  const minAmount = opts.minAmount ?? 50_000; // ETB 500
  const minDelta = opts.minDelta ?? 20_000; // ETB 200
  let best: SpendingInsight | null = null;
  for (const key of new Set([...Object.keys(current), ...Object.keys(previous)])) {
    const cur = current[key] ?? 0;
    const prev = previous[key] ?? 0;
    if (prev < minAmount || Math.abs(cur - prev) < minDelta) continue;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) continue;
    if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { categoryKey: key, current: cur, previous: prev, pct };
  }
  return best;
}

/** What I can still spend per day this month and stay within budget (null without budgets). */
export function safeToSpendToday(budgetTotal: number, spentInBudgeted: number, daysLeft: number): number | null {
  if (budgetTotal <= 0) return null;
  return Math.max(0, Math.floor((budgetTotal - spentInBudgeted) / Math.max(1, daysLeft)));
}
