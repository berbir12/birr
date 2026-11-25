import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';
import { restoreOriginalUrl } from './vercelUrl.js';

describe('restoreOriginalUrl (Vercel routing)', () => {
  it.each([
    ['/api?__birr_path=/ingest/sms', '/ingest/sms'],
    ['/api?__birr_path=/ingest/sms&token=birr_x', '/ingest/sms?token=birr_x'],
    ['/api?token=birr_x&__birr_path=/api/me', '/api/me?token=birr_x'],
    ['/ingest/sms?token=a', '/ingest/sms?token=a'], // platform already kept the original URL
    ['/api?__birr_path=//evil.example', '/api?__birr_path=//evil.example'], // never an absolute URL
  ])('%s → %s', (input, expected) => {
    expect(restoreOriginalUrl(input)).toBe(expected);
  });
});

describe('buildServer', () => {
  const CRON_SECRET = 'cron-secret-0123456789';
  let s: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    const env = loadEnv({
      BOT_TOKEN: '123456:TEST-token-abcdefghijklmnopqrstuvwxyz',
      ALLOWED_TELEGRAM_IDS: '42',
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      DATABASE_URL: 'pglite://memory',
      BOT_MODE: 'webhook',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0123456789',
      CRON_SECRET,
    });
    s = await buildServer(env);
    await s.handle.migrate();
  }, 30_000);
  afterAll(() => s.handle.close());

  it('daily cron requires the Vercel cron secret', async () => {
    expect((await s.app.request('/cron/daily')).status).toBe(401);
    expect((await s.app.request('/cron/daily', { headers: { authorization: 'Bearer wrong-secret-xxxxxxxxx' } })).status).toBe(401);
    expect((await s.app.request('/cron/daily', { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status).toBe(200);
  });

  it('telegram webhook rejects requests without the secret token', async () => {
    const res = await s.app.request('/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
