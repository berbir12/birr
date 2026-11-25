import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SummaryDto, TxDetail, TxPage } from '@birr/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { signInitData } from '../auth/initData.js';
import { budgets, categories, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { ingestBatch } from '../services/ingest.js';
import { ensureUser } from '../services/users.js';
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

function headers(id = 42) {
  const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) }, BOT_TOKEN);
  return { Authorization: `tma ${initData}`, 'content-type': 'application/json' };
}
const app = () => createApp({ db: t.db, env, encKey });
const get = async <T>(path: string, id = 42) => {
  const r = await app().request(path, { headers: headers(id) });
  return { status: r.status, body: (await r.json()) as T };
};
const send = async <T>(method: string, path: string, body?: unknown, id = 42) => {
  const r = await app().request(path, { method, headers: headers(id), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as T };
};

let userId: number;
// Fixtures are dated 23–24 Nov 2026; CBE gets received times on the same days.
const NOW = Date.parse('2026-11-24T21:00:00+03:00');

beforeEach(async () => {
  userId = (await ensureUser(t.db, 42, 'T')).id;
  await ingestBatch({ db: t.db, encKey }, userId, 'bot', TELEBIRR.map((body) => ({ body, receivedAt: NOW })));
  await ingestBatch(
    { db: t.db, encKey },
    userId,
    'webhook',
    CBE.map((body, k) => ({ body, receivedAt: NOW - (10 - k) * 3_600_000 })),
  );
});

describe('GET /api/summary', () => {
  it('balances, month totals without transfers, recent list', async () => {
    const { body: s } = await get<SummaryDto>('/api/summary');
    expect(s.accounts.map((a) => [a.name, a.balance])).toEqual([
      ['Cash', 0],
      ['telebirr', 41543],
      ['CBE ****4321', 14937196],
    ]);
    expect(s.total).toBe(41543 + 14937196);
    // In: CBE received 5,000 + 173,697 (agent cash-in is a transfer, not income).
    expect(s.monthIn).toBe(500000 + 17369700);
    // Out excludes the wallet → Awash transfer (4,500) but includes its 9.00 fees.
    expect(s.monthOut).toBeGreaterThan(0);
    expect(s.monthFees).toBeGreaterThan(900);
    expect(s.recent).toHaveLength(8);
    expect(s.safeToSpendToday).toBeNull(); // no budgets yet
    expect(s).toMatchObject({ reviewCount: 0, gapCount: 0 });
  });

  it('safe to spend appears once a budget exists', async () => {
    const [food] = await t.db.select().from(categories).where(eqKey('food'));
    await t.db.insert(budgets).values({ userId, categoryId: food!.id, amount: 3_000_000 });
    const { body } = await get<SummaryDto>('/api/summary');
    expect(body.safeToSpendToday).not.toBeNull();
  });
});

import { and, eq } from 'drizzle-orm';
const eqKey = (key: string) => and(eq(categories.userId, userId), eq(categories.key, key));

describe('GET /api/transactions', () => {
  it('newest first, paged with a cursor, no duplicates across pages', async () => {
    const p1 = (await get<TxPage>('/api/transactions?limit=8')).body;
    const p2 = (await get<TxPage>(`/api/transactions?limit=8&cursor=${p1.nextCursor}`)).body;
    const p3 = (await get<TxPage>(`/api/transactions?limit=8&cursor=${p2.nextCursor}`)).body;
    const all = [...p1.items, ...p2.items, ...p3.items];
    expect(all).toHaveLength(21);
    expect(new Set(all.map((x) => x.id)).size).toBe(21);
    expect(p3.nextCursor).toBeNull();
    const times = all.map((x) => x.occurredAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by direction, account, amount range; searches names, notes and amounts', async () => {
    const ins = (await get<TxPage>('/api/transactions?direction=in')).body.items;
    expect(ins.every((x) => x.direction === 'in')).toBe(true);
    expect(ins).toHaveLength(3);

    const big = (await get<TxPage>('/api/transactions?minAmount=1000000')).body.items;
    expect(big.map((x) => x.amount).sort((a, b) => a - b)).toEqual([1500000, 17369700]);

    expect((await get<TxPage>('/api/transactions?q=selam')).body.items.map((x) => x.counterparty)).toEqual(['Selam Bekele']);
    expect((await get<TxPage>('/api/transactions?q=5,500')).body.items).toHaveLength(1);
    expect((await get<TxPage>('/api/transactions?q=100%25')).body.items).toHaveLength(0); // % is literal
    expect((await get<TxPage>('/api/transactions?direction=sideways')).status).toBe(400);
  });

  it('marks internal transfers and list fields', async () => {
    const [first] = (await get<TxPage>('/api/transactions?limit=1')).body.items;
    expect(first).toMatchObject({ counterparty: 'Selam Bekele', charges: 800, accountName: 'telebirr', internal: false });
  });
});

describe('transaction detail and edits', () => {
  const firstId = async () => (await get<TxPage>('/api/transactions?limit=1')).body.items[0]!.id;

  it('detail, and the original SMS on demand', async () => {
    const id = await firstId();
    const { body: d } = await get<TxDetail>(`/api/transactions/${id}`);
    expect(d).toMatchObject({ amount: 550000, fee: 696, vat: 104, balanceAfter: 41543, counterpartyMaskedId: '****1234' });
    const { body: s } = await get<{ body: string }>(`/api/transactions/${id}/sms`);
    expect(s.body).toContain('You have transferred ETB 5,500.00');
  });

  it('category change offers a rule; the rule applies to past ones', async () => {
    const id = await firstId();
    const [family] = await t.db.select().from(categories).where(eqKey('family'));
    const { body } = await send<{ rulePrompt: unknown; tx: TxDetail }>('PATCH', `/api/transactions/${id}`, { categoryId: family!.id });
    expect(body.tx.categoryKey).toBe('family');
    expect(body.rulePrompt).toEqual({ counterparty: 'Selam Bekele', categoryId: family!.id, categoryName: 'Family support' });
    expect((await send('POST', `/api/transactions/${id}/rule`, { categoryId: family!.id })).status).toBe(200);
  });

  it('note with tags, amount; delete and restore', async () => {
    const id = await firstId();
    const { body } = await send<{ tx: TxDetail }>('PATCH', `/api/transactions/${id}`, { note: 'school fees #kids', amount: 550100 });
    expect(body.tx).toMatchObject({ note: 'school fees', tags: ['kids'], amount: 550100 });
    expect((await send('PATCH', `/api/transactions/${id}`, { bogus: 1 })).status).toBe(400);

    await send('DELETE', `/api/transactions/${id}`);
    expect((await get<TxPage>('/api/transactions')).body.items.some((x) => x.id === id)).toBe(false);
    await send('POST', `/api/transactions/${id}/restore`);
    expect((await get<TxPage>('/api/transactions')).body.items.some((x) => x.id === id)).toBe(true);
  });

  it("can't see or touch another user's transactions", async () => {
    const id = await firstId();
    await ensureUser(t.db, 43, 'Other');
    expect((await get(`/api/transactions/${id}`, 43)).status).toBe(404);
    expect((await get(`/api/transactions/${id}/sms`, 43)).status).toBe(404);
    expect((await send('PATCH', `/api/transactions/${id}`, { note: 'x' }, 43)).status).toBe(404);
    expect((await get<TxPage>('/api/transactions', 43)).body.items).toHaveLength(0);
  });
});

describe('review queue', () => {
  const promo = 'Dear customer, telebirr now offers 10% cashback on merchant payments. Ethio telecom';
  beforeEach(async () => {
    await ingestBatch({ db: t.db, encKey }, userId, 'bot', [{ body: promo, receivedAt: NOW }]);
  });

  it('lists with decrypted text; resolve creates a transaction', async () => {
    const { body: items } = await get<Array<{ id: number; body: string }>>('/api/review');
    expect(items).toHaveLength(1);
    expect(items[0]!.body).toBe(promo);
    const r = await send<{ txId: number }>('POST', `/api/review/${items[0]!.id}/resolve`, {
      source: 'telebirr',
      direction: 'out',
      kind: 'merchant_payment',
      amount: 25000,
      counterpartyName: 'Shemachoch',
      occurredAt: NOW,
    });
    expect(r.status).toBe(200);
    expect((await get<TxDetail>(`/api/transactions/${r.body.txId}`)).body).toMatchObject({ amount: 25000, confirmed: true });
    expect((await get<unknown[]>('/api/review')).body).toHaveLength(0);
  });

  it('dismiss; retry keeps unknown formats in review', async () => {
    const { body: items } = await get<Array<{ id: number }>>('/api/review');
    expect((await send<{ created: number; stillInReview: number }>('POST', '/api/review/retry', {})).body).toEqual({ created: 0, stillInReview: 1 });
    const again = (await get<Array<{ id: number }>>('/api/review')).body;
    expect(again).toHaveLength(1);
    await send('POST', `/api/review/${again[0]!.id}/dismiss`);
    expect((await get<unknown[]>('/api/review')).body).toHaveLength(0);
    expect(items[0]!.id).not.toBe(again[0]!.id); // retried items are re-created
  });
});

describe('settings', () => {
  it('read and update; validation', async () => {
    const { body } = await send<{ calendarMode: string; digestTime: string }>('PATCH', '/api/settings', { calendarMode: 'ethiopian', digestTime: '20:30' });
    expect(body).toMatchObject({ calendarMode: 'ethiopian', digestTime: '20:30' });
    expect((await send('PATCH', '/api/settings', { digestTime: '25:00' })).status).toBe(400);
    expect((await send('PATCH', '/api/settings', { telegramId: 1 })).status).toBe(400);
  });

  it('forwarding token: shown once, then reported as connected; revoke', async () => {
    const { body } = await send<{ url: string; token: string }>('POST', '/api/settings/ingest-secret');
    expect(body.token).toMatch(/^birr_/);
    expect((await get<{ ingest: { connected: boolean } }>('/api/settings')).body.ingest.connected).toBe(true);
    await send('DELETE', '/api/settings/ingest-secret');
    expect((await get<{ ingest: { connected: boolean } }>('/api/settings')).body.ingest.connected).toBe(false);
  });

  it('categories: create, rename, archive', async () => {
    const { body: c } = await send<{ id: number; key: string }>('POST', '/api/categories', { name: 'Coffee', icon: '☕' });
    expect(c.key).toBe('custom-coffee');
    const { body: renamed } = await send<{ name: string; archived: boolean }>('PATCH', `/api/categories/${c.id}`, { name: 'Buna', archived: true });
    expect(renamed).toMatchObject({ name: 'Buna', archived: true });
    expect((await send('POST', '/api/categories', { name: 'Coffee' })).body).toMatchObject({ key: 'custom-coffee-1' });
  });

  it('delete all data requires the confirmation phrase, then wipes everything', async () => {
    expect((await send('POST', '/api/me/delete', { confirm: 'yes' })).status).toBe(400);
    expect((await send('POST', '/api/me/delete', { confirm: 'DELETE' })).status).toBe(200);
    expect(await t.db.select().from(users)).toHaveLength(0);
    // The next visit starts a fresh, empty account.
    expect((await get<TxPage>('/api/transactions')).body.items).toHaveLength(0);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });
});
