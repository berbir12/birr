import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { signInitData } from './auth/initData.js';
import { accounts, categories } from './db/schema.js';
import { loadEnv } from './env.js';
import { useTestDb } from './test/db.js';

const BOT_TOKEN = '123456:TEST-token-abcdefghijklmnopqrstuvwxyz';
const env = loadEnv({
  BOT_TOKEN,
  ALLOWED_TELEGRAM_IDS: '42',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

function auth(id: number) {
  const initData = signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) },
    BOT_TOKEN,
  );
  return { Authorization: `tma ${initData}` };
}

describe('API auth', () => {
  const t = useTestDb();
  const app = () => createApp({ db: t.db, env, encKey: randomBytes(32) });

  it('401 without initData', async () => {
    expect((await app().request('/api/me')).status).toBe(401);
  });

  it('403 for a valid user not on the allowlist', async () => {
    expect((await app().request('/api/me', { headers: auth(7) })).status).toBe(403);
  });

  it('creates the allowed user with default categories on first call', async () => {
    const res = await app().request('/api/me', { headers: auth(42) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ firstName: 'T', locale: 'en' });
    expect((await t.db.select().from(categories)).length).toBeGreaterThan(10);
    expect((await t.db.select().from(accounts)).map((a) => a.type)).toEqual(['cash']);
  });

  it('errors are logged without their (sensitive) message', async () => {
    const a = app();
    a.get('/boom', () => {
      throw Object.assign(new Error('Failed query: insert ... params: 550000,Selam Bekele'), { code: '23505' });
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await a.request('/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('Selam');
    const logged = spy.mock.calls.flat().join(' ');
    spy.mockRestore();
    expect(logged).toContain('(23505)');
    expect(logged).not.toMatch(/Selam|550000|params/);
  });

  it('import API: preview → commit, and the gaps list', async () => {
    const a = app();
    const body = readFileSync(join(import.meta.dirname, '../../../packages/parser/fixtures/sms/cbe/c01_transfer_in.txt'), 'utf8');
    const later = readFileSync(join(import.meta.dirname, '../../../packages/parser/fixtures/sms/cbe/c03_debit.txt'), 'utf8');
    const headers = { ...auth(42), 'content-type': 'application/json' };

    const p = await a.request('/api/import/preview', { method: 'POST', headers, body: JSON.stringify({ fileName: 'x.txt', content: `${later}\n\n${body}` }) }); // newest first, like a phone
    expect(p.status).toBe(200);
    const { importId, summary } = await p.json();
    expect(summary).toMatchObject({ relevant: 2, created: 2 });

    const c = await a.request(`/api/import/${importId}/commit`, { method: 'POST', headers });
    expect(await c.json()).toMatchObject({ counts: { created: 2 }, gaps: 1, linked: 0 });
    expect((await a.request(`/api/import/${importId}/commit`, { method: 'POST', headers })).status).toBe(409);

    const g = await (await a.request('/api/reconciliation/gaps', { headers })).json();
    expect(g.gaps).toHaveLength(1);
    expect(g.gaps[0]).toMatchObject({ accountName: 'CBE ****4321', delta: -348120 });
  });

  it('import API rejects bad input and other users’ imports', async () => {
    const a = app();
    const headers = { ...auth(42), 'content-type': 'application/json' };
    expect((await a.request('/api/import/preview', { method: 'POST', headers, body: '{}' })).status).toBe(400);
    expect((await a.request('/api/import/abc/commit', { method: 'POST', headers })).status).toBe(404);
    expect((await a.request('/api/import/999/commit', { method: 'POST', headers })).status).toBe(409);
  });

  it('two concurrent first requests create one user', async () => {
    const a = app();
    const [r1, r2] = await Promise.all([a.request('/api/me', { headers: auth(42) }), a.request('/api/me', { headers: auth(42) })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect((await t.db.select().from(accounts)).length).toBe(1);
  });
});
