import { describe, expect, it } from 'vitest';
import {
  budgetAlertDue,
  budgetStatus,
  cashflow,
  dailySpending,
  debtBalances,
  detectRecurring,
  feeSummary,
  goalProgress,
  spendOf,
  topCounterparties,
  type PlanTx,
} from './plan.js';

const DAY = 86400_000;
const T0 = Date.parse('2026-09-01T10:00:00+03:00');
let nextId = 1;
const tx = (p: Partial<PlanTx>): PlanTx => ({
  id: nextId++,
  occurredAt: T0,
  direction: 'out',
  kind: 'transfer_out',
  amount: 10000,
  fee: 0,
  vat: 0,
  otherCharges: 0,
  source: 'telebirr',
  counterpartyName: null,
  personId: null,
  categoryKey: 'food',
  categoryIsSpending: true,
  internal: false,
  ...p,
});

describe('spending rules', () => {
  it('own-money moves cost only their fees', () => {
    expect(spendOf(tx({ amount: 450000, fee: 783, vat: 117, categoryKey: 'transfers', categoryIsSpending: false }))).toBe(900);
    expect(spendOf(tx({ amount: 10000, fee: 1000, internal: true }))).toBe(1000);
    expect(spendOf(tx({ amount: 5000, fee: 87, vat: 13 }))).toBe(5100);
    expect(spendOf(tx({ direction: 'in', amount: 5000 }))).toBe(0);
  });
});

describe('analytics', () => {
  it('daily spending by local day', () => {
    const key = (ms: number) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
    const r = dailySpending([tx({ amount: 1000 }), tx({ amount: 2000, occurredAt: T0 + 3600_000 }), tx({ amount: 500, occurredAt: T0 + DAY })], key);
    expect(r).toEqual({ '2026-09-01': 3000, '2026-09-02': 500 });
  });

  it('cashflow per bucket', () => {
    const buckets = [
      { key: 'a', start: T0, end: T0 + 10 * DAY },
      { key: 'b', start: T0 + 10 * DAY, end: T0 + 20 * DAY },
    ];
    const r = cashflow(
      [tx({ amount: 1000 }), tx({ direction: 'in', amount: 9000, categoryKey: 'income', categoryIsSpending: false, occurredAt: T0 + 12 * DAY })],
      buckets,
    );
    expect(r).toEqual([
      { key: 'a', in: 0, out: 1000 },
      { key: 'b', in: 9000, out: 0 },
    ]);
  });

  it('top counterparties merge by person, skip agents and own moves', () => {
    const r = topCounterparties([
      tx({ counterpartyName: 'Selam Bekele', personId: 1, amount: 5000 }),
      tx({ counterpartyName: 'SELAM BEKELE', personId: 1, amount: 2000 }),
      tx({ counterpartyName: 'Selam Bekele', personId: 1, direction: 'in', kind: 'transfer_in', amount: 1000 }),
      tx({ counterpartyName: 'telebirr agent 1', kind: 'cash_in', direction: 'in', amount: 100000 }),
      tx({ counterpartyName: 'Awash Bank', kind: 'wallet_to_bank', amount: 900000, categoryKey: 'transfers' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Selam Bekele', out: 7000, in: 1000, count: 3 });
  });

  it('fee summary by source', () => {
    const r = feeSummary([tx({ fee: 87, vat: 13 }), tx({ source: 'cbe', fee: 1000, vat: 150, otherCharges: 50 }), tx({})]);
    expect(r).toEqual({ total: 1300, fee: 1087, vat: 163, other: 50, bySource: { telebirr: 100, cbe: 1200 }, count: 2 });
  });
});

describe('budgets', () => {
  it('states at 80% and 100%', () => {
    expect(budgetStatus(100000, 50000, 0.5)).toMatchObject({ pct: 50, state: 'ok', remaining: 50000, projected: 100000 });
    expect(budgetStatus(100000, 80000, 0.5).state).toBe('warning');
    expect(budgetStatus(100000, 100000, 0.5).state).toBe('over');
    expect(budgetStatus(100000, 10000, 0.05).projected).toBeNull(); // too early to project
  });

  it('each alert fires once per period; a jump past 100% sends only the 100% alert', () => {
    const none = { alert80Period: null, alert100Period: null };
    expect(budgetAlertDue(79, '2026-11', none)).toBeNull();
    expect(budgetAlertDue(85, '2026-11', none)).toBe(80);
    expect(budgetAlertDue(90, '2026-11', { alert80Period: '2026-11', alert100Period: null })).toBeNull();
    expect(budgetAlertDue(120, '2026-11', { alert80Period: '2026-11', alert100Period: null })).toBe(100);
    expect(budgetAlertDue(130, '2026-11', { alert80Period: null, alert100Period: '2026-11' })).toBeNull();
    expect(budgetAlertDue(85, '2026-12', { alert80Period: '2026-11', alert100Period: '2026-11' })).toBe(80); // new month
  });
});

describe('goals', () => {
  const now = Date.parse('2026-11-01T00:00:00+03:00');
  it('suggested weekly amount, rounded up to a whole birr', () => {
    const g = goalProgress(1_000_000, 250_000, now + 10 * 7 * DAY, now);
    expect(g).toMatchObject({ pct: 25, remaining: 750_000, weeksLeft: 10, suggestedWeekly: 75_000, achieved: false, overdue: false });
    expect(goalProgress(1_000_000, 0, now + 3 * 7 * DAY, now).suggestedWeekly).toBe(333_400);
  });
  it('achieved, overdue, no deadline', () => {
    expect(goalProgress(100, 150, now - DAY, now)).toMatchObject({ achieved: true, pct: 100, overdue: false, suggestedWeekly: 0 });
    expect(goalProgress(100_000, 10_000, now - DAY, now)).toMatchObject({ overdue: true, weeksLeft: 1 });
    expect(goalProgress(100_000, 10_000, null, now)).toMatchObject({ weeksLeft: null, suggestedWeekly: null });
  });
});

describe('detectRecurring', () => {
  const now = T0 + 95 * DAY;
  const series = (name: string, everyDays: number, n: number, amount: (i: number) => number, start = T0) =>
    Array.from({ length: n }, (_, i) => tx({ counterpartyName: name, amount: amount(i), occurredAt: start + i * everyDays * DAY + (i % 2) * 3600_000 }));

  it('finds monthly rent and weekly equb with stable amounts', () => {
    const r = detectRecurring(
      [...series('Kebede Wolde', 30, 4, () => 1_200_000, T0 + 5 * DAY), ...series('Mahber Equb', 7, 13, () => 100_000, T0 + 4 * DAY)],
      now,
    );
    expect(r.map((x) => [x.label, x.intervalDays])).toEqual([
      ['Kebede Wolde', 30],
      ['Mahber Equb', 7],
    ]);
    expect(r[1]!.monthlyAmount).toBe(Math.round((100_000 * 365) / 12 / 7));
    expect(r[0]!.nextExpectedAt).toBe(r[0]!.lastSeenAt + 30 * DAY);
  });

  it('ignores daily taxis, wildly varying amounts, stopped series and own moves', () => {
    const r = detectRecurring(
      [
        ...series('Yonas Tadesse', 1, 40, () => 7000, T0 + 50 * DAY),
        ...series('Almaz Tadesse', 15, 6, (i) => [150000, 300000, 90000, 260000, 120000, 300000][i]!),
        ...series('Old Gym', 30, 3, () => 50000, T0 - 40 * DAY), // last payment 75 days before now
        ...series('Commercial Bank', 30, 4, () => 200000).map((t) => ({ ...t, internal: true })),
      ],
      now,
    );
    expect(r).toEqual([]);
  });

  it('groups airtime top-ups by kind', () => {
    const r = detectRecurring(
      Array.from({ length: 6 }, (_, i) => tx({ kind: 'data_package', categoryKey: 'airtime', amount: 30000, occurredAt: T0 + 60 * DAY + i * 7 * DAY })),
      now,
    );
    expect(r).toMatchObject([{ matchKey: 'kind:data_package', intervalDays: 7 }]);
  });
});

describe('debtBalances', () => {
  it('nets open debts per person', () => {
    const m = debtBalances([
      { personId: 1, direction: 'lent', amount: 200000, settledAt: null },
      { personId: 1, direction: 'borrowed', amount: 50000, settledAt: null },
      { personId: 2, direction: 'borrowed', amount: 70000, settledAt: null },
      { personId: 2, direction: 'lent', amount: 10000, settledAt: 123 },
    ]);
    expect([...m]).toEqual([
      [1, 150000],
      [2, -70000],
    ]);
  });
});
