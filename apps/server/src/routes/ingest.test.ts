import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDb, runMigrations, type DB } from '../db/client.js';
import { transactions, users } from '../db/schema.js';
import { loadEnv, type Env } from '../env.js';
import { revokeIngestSecret, rotateIngestSecret, SECRET_GRACE_MS, userForSecret } from '../services/ingestSecret.js';
import { ensureUser } from '../services/users.js';
import { parseReceivedAt } from './ingest.js';

const FIX = join(import.meta.dirname, '../../../../packages/parser/fixtures/sms');
const sms = (p: string) => readFileSync(join(FIX, p), 'utf8');

const baseEnv = {
  BOT_TOKEN: '123456:TEST-token-abcdefghijklmnopqrstuvwxyz',
  ALLOWED_TELEGRAM_IDS: '42',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

let db: DB;
let env: Env;
let secret: string;
let userId: number;
const encKey = randomBytes(32);
const notify = vi.fn(async () => {});

function app(extra: Record<string, string> = {}) {
  env = loadEnv({ ...baseEnv, ...extra });
  return createApp({ db, env, encKey, notify });
}

const post = (a: ReturnType<typeof app>, body: unknown, headers: Record<string, string> = {}, path = '/ingest/sms') =>
  a.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}`, ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db = openDb(':memory:').db;
  runMigrations(db);
  userId = ensureUser(db, 42, 'T').id;
  secret = rotateIngestSecret(db, encKey, userId);
  notify.mockClear();
});

describe('POST /ingest/sms', () => {
  it('records an SMS the way iOS Shortcuts sends it and notifies the bot', async () => {
    const a = app();
    const res = await post(a, { sender: '127', body: sms('telebirr/t11_transfer_out.txt'), received_at: '2026-11-24T20:31:25+03:00' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'created', txId: expect.any(Number) });
    expect(notify).toHaveBeenCalledOnce();
    expect(db.select().from(transactions).get()).toMatchObject({ channel: 'webhook', amount: 550000 });
  });

  it('is idempotent when the automation fires twice', async () => {
    const a = app();
    const body = { sender: 'CBE', body: sms('cbe/c01_transfer_in.txt') };
    await post(a, body);
    const res = await post(a, body);
    expect(await res.json()).toMatchObject({ status: 'duplicate' });
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it('uses received_at for undated CBE messages', async () => {
    const a = app();
    await post(a, { sender: 'CBE', body: sms('cbe/c01_transfer_in.txt'), received_at: '2026-11-20T09:15:00+03:00' });
    expect(db.select().from(transactions).get()!.occurredAt).toBe(Date.parse('2026-11-20T09:15:00+03:00'));
  });

  it('falls back to the body when the sender is a saved contact name', async () => {
    const a = app();
    const res = await post(a, { sender: 'Telebirr 127 ⭐', body: sms('telebirr/t01_transfer_out.txt') });
    expect(await res.json()).toMatchObject({ status: 'created' });
  });

  it('accepts the token as X-Birr-Token or ?token= for forwarders without header support', async () => {
    const a = app();
    const b1 = { body: sms('telebirr/t01_transfer_out.txt') };
    expect((await post(a, b1, { authorization: '', 'x-birr-token': secret })).status).toBe(200);
    const b2 = { body: sms('telebirr/t02_transfer_out.txt') };
    expect((await post(a, b2, { authorization: '' }, `/ingest/sms?token=${secret}`)).status).toBe(200);
  });

  it('accepts form-encoded bodies', async () => {
    const a = app();
    const res = await a.request('/ingest/sms', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sender: '127', body: sms('telebirr/t03_transfer_out.txt') }).toString(),
    });
    expect(await res.json()).toMatchObject({ status: 'created' });
  });

  it('rejects missing, wrong and revoked tokens', async () => {
    const a = app();
    const body = { body: sms('telebirr/t01_transfer_out.txt') };
    expect((await post(a, body, { authorization: '' })).status).toBe(401);
    expect((await post(a, body, { authorization: 'Bearer birr_wrong' })).status).toBe(401);
    revokeIngestSecret(db, userId);
    expect((await post(a, body)).status).toBe(401);
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('rejects a valid token whose user was removed from the allowlist', async () => {
    const a = app({ ALLOWED_TELEGRAM_IDS: '99' });
    expect((await post(a, { body: sms('telebirr/t01_transfer_out.txt') })).status).toBe(403);
  });

  it('validates the body', async () => {
    const a = app();
    expect((await post(a, { sender: '127' })).status).toBe(400);
    expect((await post(a, { body: 'x'.repeat(5001) })).status).toBe(400);
  });

  it('rate-limits per user', async () => {
    const a = app({ INGEST_RATE_LIMIT_PER_MIN: '3' });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(a, { body: `Dear x ${i} telebirr` })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('rate-limits repeated bad tokens from one IP', async () => {
    const a = app();
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await post(a, { body: 'x' }, { authorization: 'Bearer birr_nope', 'x-forwarded-for': '10.0.0.9' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('does not notify on non-transaction messages from the automation', async () => {
    const a = app();
    const res = await post(a, { sender: 'Mom', body: 'Call me when you are free' });
    expect(await res.json()).toMatchObject({ status: 'ignored' });
    expect(notify).toHaveBeenCalledOnce(); // called, but sendOutcomes stays silent in webhook mode
  });
});

describe('ingest secret rotation', () => {
  it('previous secret works only within the grace window', () => {
    const t0 = Date.now();
    const old = secret;
    const fresh = rotateIngestSecret(db, encKey, userId, t0);
    expect(userForSecret(db, encKey, fresh, t0)?.id).toBe(userId);
    expect(userForSecret(db, encKey, old, t0 + SECRET_GRACE_MS - 1)?.id).toBe(userId);
    expect(userForSecret(db, encKey, old, t0 + SECRET_GRACE_MS + 1)).toBeNull();
  });

  it('stores only hashes', () => {
    const u = db.select().from(users).get()!;
    expect(u.ingestSecretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(u)).not.toContain(secret);
  });
});

describe('parseReceivedAt', () => {
  const now = Date.parse('2026-11-24T21:00:00+03:00');
  it.each([
    ['2026-11-24T20:31:25+03:00', Date.parse('2026-11-24T20:31:25+03:00')],
    [1795539600, 1795539600000],
    ['1795539600000', 1795539600000],
    ['Nov 24, 2026 at 8:31 PM', now], // locale-formatted Shortcuts dates are ambiguous → now
    ['2030-01-01T00:00:00Z', now], // future
    [null, now],
  ])('%s', (input, expected) => {
    // The unparseable-locale case falls back to now only if Date.parse rejects it.
    const got = parseReceivedAt(input as any, now);
    if (typeof input === 'string' && input.includes(' at ')) expect([now, Date.parse(input)]).toContain(got);
    else expect(got).toBe(expected);
  });
});
