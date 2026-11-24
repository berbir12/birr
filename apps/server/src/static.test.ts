import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb, runMigrations } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv({
  BOT_TOKEN: '123456:TEST-token-abcdefghijklmnopqrstuvwxyz',
  ALLOWED_TELEGRAM_IDS: '42',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('serving the Mini App without Caddy', () => {
  let app: ReturnType<typeof createApp>;
  let parent: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'birr-static-'));
    const dist = join(parent, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Birr</title>');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(parent, 'secret.env'), 'BOT_TOKEN=nope');
    const { db } = openDb(':memory:');
    runMigrations(db);
    app = createApp({ db, env, encKey: randomBytes(32), miniappDir: dist });
  });

  it('serves index.html at / with no-cache', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Birr</title>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves hashed assets as immutable', async () => {
    const res = await app.request('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to index.html for client-side routes', async () => {
    expect(await (await app.request('/review')).text()).toContain('<title>Birr</title>');
  });

  it('never serves files outside dist', async () => {
    for (const p of ['/../secret.env', '/%2e%2e/secret.env', '/..%2fsecret.env']) {
      const body = await (await app.request(p)).text();
      expect(body).not.toContain('BOT_TOKEN');
    }
  });

  it('keeps API and ingest semantics (no HTML fallback)', async () => {
    expect((await app.request('/api/unknown')).status).toBe(401);
    expect((await app.request('/ingest/nope')).status).toBe(404);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('allows Telegram Web to frame the app, nobody else', async () => {
    const res = await app.request('/');
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
  });
});
