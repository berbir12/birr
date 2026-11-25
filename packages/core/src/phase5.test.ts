import { describe, expect, it } from 'vitest';
import { dayKey, daysLeftInMonth, monthOf, monthPeriod, previousMonth, startOfDay, zonedTime } from './period.js';
import { biggestChange, safeToSpendToday, totals, type SummaryTx } from './summary.js';

const TZ = 'Africa/Addis_Ababa';

describe('periods in Addis Ababa (UTC+3)', () => {
  it('month starts at local midnight', () => {
    const p = monthOf(Date.parse('2026-11-24T20:31:20+03:00'), TZ);
    expect(p.key).toBe('2026-11');
    expect(new Date(p.start).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(new Date(p.end).toISOString()).toBe('2026-11-30T21:00:00.000Z');
    expect(p.daysInMonth).toBe(30);
  });

  it('00:30 local on the 1st belongs to the new month, though it is still the 31st in UTC', () => {
    expect(monthOf(Date.parse('2026-12-01T00:30:00+03:00'), TZ).key).toBe('2026-12');
  });

  it('previous month across a year boundary; February in a leap year', () => {
    expect(previousMonth(monthPeriod(2027, 1, TZ), TZ).key).toBe('2026-12');
    expect(monthPeriod(2028, 2, TZ).daysInMonth).toBe(29);
  });

  it('days and day keys', () => {
    const t = Date.parse('2026-11-24T01:15:00+03:00');
    expect(dayKey(t, TZ)).toBe('2026-11-24');
    expect(startOfDay(t, TZ)).toBe(Date.parse('2026-11-24T00:00:00+03:00'));
    expect(daysLeftInMonth(t, TZ)).toBe(7); // 24..30
    expect(zonedTime(TZ, 2026, 11, 24, 9, 5)).toBe(Date.parse('2026-11-24T09:05:00+03:00'));
  });

  it('works for other zones too', () => {
    expect(new Date(monthPeriod(2026, 7, 'Europe/Berlin').start).toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
});

describe('totals', () => {
  const tx = (p: Partial<SummaryTx>): SummaryTx => ({
    direction: 'out',
    amount: 0,
    fee: 0,
    vat: 0,
    otherCharges: 0,
    categoryKey: 'food',
    categoryIsSpending: true,
    internal: false,
    ...p,
  });

  it('spending by category, with fees on their own', () => {
    const r = totals([
      tx({ amount: 550000, fee: 696, vat: 104, categoryKey: 'family' }),
      tx({ amount: 1500, fee: 87, vat: 13, categoryKey: 'transport' }),
      tx({ direction: 'in', amount: 17369700, categoryKey: 'income', categoryIsSpending: false }),
    ]);
    expect(r).toEqual({ in: 17369700, out: 551500 + 900, fees: 900, byCategory: { family: 550000, transport: 1500, fees: 900 } });
  });

  it('internal transfers and own-money moves are not income or spending, but their fees are', () => {
    const r = totals([
      tx({ amount: 450000, fee: 783, vat: 117, categoryKey: 'transfers', categoryIsSpending: false }), // wallet → Awash
      tx({ direction: 'in', amount: 970600, categoryKey: 'transfers', categoryIsSpending: false }), // agent cash-in
      tx({ amount: 10000, fee: 1000, vat: 150, otherCharges: 50, internal: true, categoryKey: 'transfers', categoryIsSpending: false }),
      tx({ direction: 'in', amount: 10000, internal: true, categoryKey: 'transfers', categoryIsSpending: false }),
    ]);
    expect(r).toEqual({ in: 0, out: 2100, fees: 2100, byCategory: { fees: 2100 } });
  });

  it('uncategorized spending lands in other', () => {
    expect(totals([tx({ amount: 100, categoryKey: null, categoryIsSpending: null })]).byCategory).toEqual({ other: 100 });
  });
});

describe('biggestChange', () => {
  it('reports the largest meaningful percent change', () => {
    expect(biggestChange({ transport: 134000, food: 300000 }, { transport: 100000, food: 290000 })).toEqual({
      categoryKey: 'transport',
      current: 134000,
      previous: 100000,
      pct: 34,
    });
  });

  it('ignores tiny categories and tiny absolute changes', () => {
    expect(biggestChange({ airtime: 16000 }, { airtime: 4000 })).toBeNull(); // +300% but only ETB 120
    expect(biggestChange({ food: 310000 }, { food: 300000 })).toBeNull(); // ETB 100 change
  });

  it('reports drops too', () => {
    expect(biggestChange({ food: 150000 }, { food: 300000 })).toMatchObject({ categoryKey: 'food', pct: -50 });
  });
});

describe('safeToSpendToday', () => {
  it('splits what is left over the remaining days', () => {
    expect(safeToSpendToday(3_000_000, 1_600_000, 7)).toBe(200000);
  });
  it('never negative; null without budgets', () => {
    expect(safeToSpendToday(100, 500, 3)).toBe(0);
    expect(safeToSpendToday(0, 0, 10)).toBeNull();
  });
});
