/**
 * Assembles the whole backend (HTTP app + bot) from an Env. Used by both entry points:
 *   - src/index.ts   local dev / any long-running Node host (polling or webhook)
 *   - src/vercel.ts  Vercel serverless function (webhook only)
 */
import { timingSafeEqual } from 'node:crypto';
import { webhookCallback } from 'grammy';
import { and, isNotNull, lt } from 'drizzle-orm';
import { createApp } from './app.js';
import { createBot, makeNotifier } from './bot/index.js';
import { openDb, type DbHandle } from './db/client.js';
import { botState } from './db/schema.js';
import type { Env } from './env.js';
import { purgeRateLimits } from './rateLimit.js';
import { purgeExpiredImports } from './services/importer.js';

function safeEqual(got: string | undefined, expected: string | undefined): boolean {
  if (!got || !expected) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface BuildOptions {
  miniappDir?: string;
}

export async function buildServer(env: Env, opts: BuildOptions = {}) {
  const handle: DbHandle = await openDb(env.DATABASE_URL);
  const { db } = handle;
  const encKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  const deps = { db, env, encKey };

  const bot = createBot(deps);
  const app = createApp({ ...deps, notify: makeNotifier(bot.api, deps), miniappDir: opts.miniappDir });

  if (env.BOT_MODE === 'webhook') {
    const handleUpdate = webhookCallback(bot, 'hono', { secretToken: env.TELEGRAM_WEBHOOK_SECRET });
    app.post('/telegram/webhook', (c) => {
      // Check the secret ourselves first: grammY would otherwise call Telegram's getMe (on a cold
      // start) before rejecting, turning every junk request into an outbound API call.
      if (!safeEqual(c.req.header('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
        return c.json({ ok: false }, 401);
      }
      return handleUpdate(c);
    });
  }

  // Daily housekeeping (Vercel Cron). Later phases add the digest and alerts here.
  app.get('/cron/daily', async (c) => {
    if (!env.CRON_SECRET || !safeEqual(c.req.header('authorization'), `Bearer ${env.CRON_SECRET}`)) {
      return c.json({ ok: false }, 401);
    }
    await purgeRateLimits(db);
    await purgeExpiredImports(db);
    await db.delete(botState).where(and(isNotNull(botState.expiresAt), lt(botState.expiresAt, Date.now())));
    return c.json({ ok: true });
  });

  return { app, bot, db, handle, encKey };
}
