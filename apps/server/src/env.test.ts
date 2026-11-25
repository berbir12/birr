import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  BOT_TOKEN: '123456:TEST-token-abcdefghijklmnopqrstuvwxyz',
  ALLOWED_TELEGRAM_IDS: '42, 43',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('loadEnv', () => {
  it('treats blank values from .env.example as unset', () => {
    const env = loadEnv({ ...base, DATABASE_URL: '', CRON_SECRET: '', TELEGRAM_WEBHOOK_SECRET: '  ', ANTHROPIC_API_KEY: '' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.BOT_MODE).toBe('polling');
    expect(env.ALLOWED_TELEGRAM_IDS).toEqual([42, 43]);
  });

  it('requires the webhook secret in webhook mode', () => {
    expect(() => loadEnv({ ...base, BOT_MODE: 'webhook' })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('rejects a malformed encryption key and names the variable', () => {
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: 'short' })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it('requires an API key when the LLM fallback is on', () => {
    expect(() => loadEnv({ ...base, LLM_FALLBACK_ENABLED: 'true' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
