import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalyticsDto, BudgetsDto, DebtDto, GoalDto, PersonDetailDto, PersonDto, RecurringDto, TxPage } from '@birr/shared';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { signInitData } from '../auth/initData.js';
import { categories, transactions } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { ingestBatch } from '../services/ingest.js';
import { dueBudgetAlerts } from '../services/plan.js';
import { ensureUser, type User } from '../services/users.js';
import { useTestDb } from '../test/db.js';

const FIX = join(import.meta.dirname, '../../../../packages/parser/fixtures/sms');
const read = (dir: string) =>
  readdirSync(join(FIX, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => readFileSync(join(FIX, dir, f), 'utf8'));
const TELEBIRR = read('telebirr');
const CBE = read('cbe');

const BOT_TOKEN = '123456:TEST-token-abcdefghijklmnopqrstuvwxyz';
const env = loadEnv({ BOT_TOKEN, ALLOWED_TELEGRAM_IDS: '42,43', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
const encKey = randomBytes(32);
const t = useTestDb();
const headers = (id = 42) => ({
  Authorization: `tma ${signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) }, BOT_TOKEN)}`,
  'content-type': 'application/json',
});
const call = async <T>(method: string, path: string, body?: unknown, id = 42) => {
  const r = await createApp({ db: t.db, env, encKey }).request(`/api${path}`, { method, headers: headers(id), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as T };
};

let user: User;
const catId = async (key: string) =>
  (await t.db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.key, key))))[0]!.id;

/** Today's real clock decides "this month", so fixtures are re-dated to now. */
const NOW = Date.now();
async function ingestNow(bodies: string[]) {
  return ingestBatch({ db: t.db, encKey }, user.id, 'webhook', bodies.map((body, k) => ({ body, receivedAt: NOW - (bodies.length - k) * 60_000 })));
}
// CBE messages are undated, so they land "now"; telebirr ones carry their own (Nov 2026) dates.

beforeEach(async () => {
  user = await ensureUser(t.db, 42, 'T');
});

describe('analytics', () => {
  it('this month: by category, daily, top people, fees', async () => {
    await ingestNow(CBE);
    const { body: a } = await call<AnalyticsDto>('GET', '/analytics?range=month');
    expect(a.range).toBe('month');
    // CBE: transfers out to people (other category) + debits; received money is income.
    expect(a.totalIn).toBe(500000 + 17369700);
    expect(a.byCategory.length).toBeGreaterThan(0);
    expect(a.byCategory.reduce((s, c) => s + c.amount, 0)).toBe(a.totalOut);
    expect(Object.values(a.daily).reduce((s, v) => s + v, 0)).toBe(a.totalOut);
    expect(a.topPeople[0]).toMatchObject({ name: 'Yared Tsegaye Bekele', in: 17369700 });
    expect(a.fees.bySource.cbe).toBe(a.fees.total);
    expect(a.cashflow).toHaveLength(6);
    expect(a.cashflow.at(-1)!.in).toBe(a.totalIn);
  });

  it('bad range falls back to this month', async () => {
    expect((await call<AnalyticsDto>('GET', '/analytics?range=forever')).body.range).toBe('month');
  });
});

describe('budgets and alerts', () => {
  it('set, list with spent/pct/state, alerts once at 80% and once at 100%', async () => {
    const other = await catId('other');
    // CBE debits are "other": c03 1,960 + c06 1,600 + c07 100 + c10 100 = 3,760.00 (fees are separate).
    await call('PUT', `/budgets/${other}`, { amount: 450000 });
    await ingestNow([CBE[2]!, CBE[5]!]); // 3,560 → 79%
    expect(await dueBudgetAlerts(t.db, user)).toEqual([]);

    await ingestNow([CBE[6]!]); // 3,660 → 81%
    const first = await dueBudgetAlerts(t.db, user);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/Other.*81% of your ETB 4,500.00 budget used/);
    expect(await dueBudgetAlerts(t.db, user)).toEqual([]); // not again this month

    await call('PUT', `/budgets/${other}`, { amount: 360000 }); // now over
    const over = await dueBudgetAlerts(t.db, user);
    expect(over[0]).toMatch(/over budget/);
    expect(await dueBudgetAlerts(t.db, user)).toEqual([]);

    const { body: b } = await call<BudgetsDto>('GET', '/budgets');
    expect(b.budgets[0]).toMatchObject({ categoryKey: 'other', amount: 360000, spent: 366000, state: 'over', pct: 101 });
    expect(b.total).toEqual({ amount: 360000, spent: 366000 });
  });

  it('validation and isolation', async () => {
    expect((await call('PUT', `/budgets/${await catId('food')}`, { amount: 0 })).status).toBe(400);
    await ensureUser(t.db, 43, 'Other');
    expect((await call('PUT', `/budgets/${await catId('food')}`, { amount: 1000 }, 43)).status).toBe(404);
    expect((await call('DELETE', `/budgets/${await catId('food')}`)).status).toBe(200);
  });
});

describe('goals', () => {
  it('create, contribute until achieved, withdraw, archive', async () => {
    const deadline = NOW + 10 * 7 * 86400_000;
    const { body: g } = await call<GoalDto>('POST', '/goals', { name: 'Laptop', emoji: '💻', target: 6000000, deadline });
    expect(g).toMatchObject({ pct: 0, weeksLeft: 10, suggestedWeekly: 600000 });
    const { body: half } = await call<GoalDto>('POST', `/goals/${g.id}/contribute`, { amount: 3000000 });
    expect(half).toMatchObject({ pct: 50, remaining: 3000000, achievedAt: null });
    const { body: done } = await call<GoalDto>('POST', `/goals/${g.id}/contribute`, { amount: 3000000 });
    expect(done.pct).toBe(100);
    expect(done.achievedAt).not.toBeNull();
    const { body: back } = await call<GoalDto>('POST', `/goals/${g.id}/contribute`, { amount: -7000000 });
    expect(back.saved).toBe(0); // never negative
    await call('PATCH', `/goals/${g.id}`, { archived: true });
    expect((await call<GoalDto[]>('GET', '/goals')).body).toHaveLength(0);
    expect((await call('POST', `/goals/${g.id}/contribute`, { amount: 0 })).status).toBe(400);
  });
});

describe('people and debts', () => {
  it('people with totals; a debt by name; settle with a matching transaction', async () => {
    await ingestNow(CBE);
    const { body: ppl } = await call<PersonDto[]>('GET', '/people');
    const biniam = ppl.find((p) => p.name === 'Biniam Mulugeta Assefa')!;
    expect(biniam).toMatchObject({ out: 500000, in: 500000, count: 2, balance: 0 });

    // "I lent Biniam 5,000" before he paid it back (c01 is the incoming 5,000).
    const { body: d } = await call<DebtDto>('POST', '/debts', { personId: biniam.id, direction: 'lent', amount: 500000, note: 'school fees' });
    const { body: detail } = await call<PersonDetailDto>('GET', `/people/${biniam.id}`);
    expect(detail.person.balance).toBe(500000);
    expect(detail.recent).toHaveLength(2);

    const { body: cands } = await call<TxPage['items']>('GET', `/debts/${d.id}/candidates`);
    expect(cands[0]).toMatchObject({ direction: 'in', amount: 500000 });
    await call('POST', `/debts/${d.id}/settle`, { transactionId: cands[0]!.id });
    expect((await call<PersonDto[]>('GET', '/people')).body.find((p) => p.id === biniam.id)!.balance).toBe(0);
    await call('POST', `/debts/${d.id}/reopen`);
    expect((await call<PersonDto[]>('GET', '/people')).body.find((p) => p.id === biniam.id)!.balance).toBe(500000);
  });

  it('a debt for someone new creates the person; "I owe" is negative', async () => {
    const { body: d } = await call<DebtDto>('POST', '/debts', { personName: 'abebe kebede', direction: 'borrowed', amount: 200000 });
    expect(d.personName).toBe('abebe kebede');
    const { body: ppl } = await call<PersonDto[]>('GET', '/people');
    expect(ppl[0]).toMatchObject({ balance: -200000 });
    expect((await call('POST', '/debts', { direction: 'lent', amount: 1 })).status).toBe(400);
  });
});

describe('recurring', () => {
  it('detects monthly rent from four payments; dismiss hides it', async () => {
    const rent = CBE[8]!; // c09: 2,500.00 to Tesfaye W/mariam Desta
    const DAY = 86400_000;
    for (let k = 0; k < 4; k++) {
      await ingestBatch({ db: t.db, encKey }, user.id, 'webhook', [
        { body: rent.replace('FakeRcptToken0000c09', `FakeRcptTokenRent${k}c09`), receivedAt: NOW - (90 - k * 30) * DAY },
      ]);
    }
    const { body: r } = await call<{ items: RecurringDto[]; monthlyTotal: number }>('GET', '/recurring');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ label: 'Tesfaye W/mariam Desta', intervalDays: 30, avgAmount: 250000 });
    expect(r.monthlyTotal).toBe(250000);
    await call('POST', `/recurring/${r.items[0]!.id}/dismiss`);
    expect((await call<{ items: RecurringDto[] }>('GET', '/recurring')).body.items).toHaveLength(0);
    // Re-detection keeps the dismissal.
    expect((await call<{ items: RecurringDto[] }>('GET', '/recurring')).body.items).toHaveLength(0);
    expect(await t.db.select().from(transactions)).toHaveLength(4);
  });
});
