import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import { createApp } from './app.js';
import { BOT_COMMANDS, createBot, makeNotifier } from './bot/index.js';
import { openDb, runMigrations } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
process.env.TZ = env.TZ;

const { db, sqlite } = openDb(env.DATABASE_PATH);
runMigrations(db);

const encKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
const bot = createBot({ db, env, encKey });
const miniappDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../miniapp/dist');
if (env.SERVE_MINIAPP && !existsSync(miniappDir)) {
  throw new Error(`SERVE_MINIAPP=true but ${miniappDir} does not exist. Run: pnpm --filter @birr/miniapp build`);
}
const app = createApp({
  db,
  env,
  encKey,
  notify: makeNotifier(bot.api, { db, env, encKey }),
  miniappDir: env.SERVE_MINIAPP ? miniappDir : undefined,
});
await bot.api.setMyCommands(BOT_COMMANDS).catch((e: unknown) => console.warn('[bot] setMyCommands failed', e instanceof Error ? e.message : e));

if (env.BOT_MODE === 'webhook') {
  app.post(
    '/telegram/webhook',
    webhookCallback(bot, 'hono', { secretToken: env.TELEGRAM_WEBHOOK_SECRET }),
  );
  await bot.api.setWebhook(`${env.PUBLIC_URL}/telegram/webhook`, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
} else {
  await bot.api.deleteWebhook();
  void bot.start({ onStart: (me) => console.log(`[bot] polling as @${me.username}`) });
}

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) =>
  console.log(`[api] listening on ${env.HOST}:${info.port}`),
);

function shutdown() {
  void bot.stop();
  server.close();
  sqlite.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
