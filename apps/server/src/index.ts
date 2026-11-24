import { serve } from '@hono/node-server';
import { webhookCallback } from 'grammy';
import { createApp } from './app.js';
import { createBot } from './bot/index.js';
import { openDb, runMigrations } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
process.env.TZ = env.TZ;

const { db, sqlite } = openDb(env.DATABASE_PATH);
runMigrations(db);

const encKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
const app = createApp({ db, env, encKey });
const bot = createBot({ db, env });

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

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  console.log(`[api] listening on :${info.port}`),
);

function shutdown() {
  void bot.stop();
  server.close();
  sqlite.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
