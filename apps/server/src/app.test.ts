import { randomBytes } from 'node:crypto';
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

  it('two concurrent first requests create one user', async () => {
    const a = app();
    const [r1, r2] = await Promise.all([a.request('/api/me', { headers: auth(42) }), a.request('/api/me', { headers: auth(42) })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect((await t.db.select().from(accounts)).length).toBe(1);
  });
});
