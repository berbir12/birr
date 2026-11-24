import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { signInitData } from './auth/initData.js';
import { openDb, runMigrations, type DB } from './db/client.js';
import { loadEnv } from './env.js';

const BOT_TOKEN = '123456:TEST-token-abcdefghijklmnopqrstuvwxyz';
const env = loadEnv({
  BOT_TOKEN,
  ALLOWED_TELEGRAM_IDS: '42',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DATABASE_PATH: ':memory:',
});

function auth(id: number) {
  const initData = signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) },
    BOT_TOKEN,
  );
  return { Authorization: `tma ${initData}` };
}

describe('API auth', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:').db;
    runMigrations(db);
  });

  it('401 without initData', async () => {
    const app = createApp({ db, env, encKey: randomBytes(32) });
    expect((await app.request('/api/me')).status).toBe(401);
  });

  it('403 for a valid user not on the allowlist', async () => {
    const app = createApp({ db, env, encKey: randomBytes(32) });
    expect((await app.request('/api/me', { headers: auth(7) })).status).toBe(403);
  });

  it('creates the allowed user with default categories on first call', async () => {
    const app = createApp({ db, env, encKey: randomBytes(32) });
    const res = await app.request('/api/me', { headers: auth(42) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ firstName: 'T', locale: 'en' });
    const cats = db.query.categories.findMany().sync();
    expect(cats.length).toBeGreaterThan(10);
    const accts = db.query.accounts.findMany().sync();
    expect(accts.map((a) => a.type)).toEqual(['cash']);
  });
});
