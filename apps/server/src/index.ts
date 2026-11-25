/**
 * Long-running entry point (local development). In production Birr runs on Vercel (src/vercel.ts).
 * With DATABASE_URL unset it uses a local PGlite folder (data/pglite), so no database server is needed.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { BOT_COMMANDS } from './bot/index.js';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadEnv();
process.env.TZ = env.TZ;

const miniappDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../miniapp/dist');
if (env.SERVE_MINIAPP && !existsSync(miniappDir)) {
  throw new Error(`SERVE_MINIAPP=true but ${miniappDir} does not exist. Run: pnpm --filter @birr/miniapp build`);
}

const { app, bot, handle } = await buildServer(env, { miniappDir: env.SERVE_MINIAPP ? miniappDir : undefined });
await handle.migrate();

await bot.api
  .setMyCommands(BOT_COMMANDS)
  .catch((e: unknown) => console.warn('[bot] setMyCommands failed', e instanceof Error ? e.message : e));

if (env.BOT_MODE === 'webhook') {
  await bot.api.setWebhook(`${env.PUBLIC_URL}/telegram/webhook`, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
} else {
  // Polling needs the webhook removed, which would cut the production bot (on Vercel) off.
  const info = await bot.api.getWebhookInfo();
  if (info.url && process.env.BIRR_FORCE_POLLING !== '1') {
    throw new Error(
      `This bot has a webhook (${info.url}), so it is probably your production bot. ` +
        'Use a separate test bot token for local development, or set BIRR_FORCE_POLLING=1 to take it over.',
    );
  }
  await bot.api.deleteWebhook();
  void bot.start({ onStart: (me) => console.log(`[bot] polling as @${me.username}`) });
}

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) =>
  console.log(`[api] listening on ${env.HOST}:${info.port}`),
);

async function shutdown() {
  await bot.stop().catch(() => {});
  server.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
