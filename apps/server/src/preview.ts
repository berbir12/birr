/**
 * Local UI preview: the real API on your local (seeded) database with the dev browser login,
 * WITHOUT starting the Telegram bot. Pair with `pnpm --filter @birr/miniapp dev` and open
 * http://localhost:5173 in a normal browser.
 *
 *   pnpm seed && pnpm preview
 *
 * Needs NODE_ENV=development and DEV_AUTH_TELEGRAM_ID (one of ALLOWED_TELEGRAM_IDS) in .env.
 */
import { serve } from '@hono/node-server';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadEnv();
if (env.DEV_AUTH_TELEGRAM_ID === undefined) {
  console.error('Set NODE_ENV=development and DEV_AUTH_TELEGRAM_ID=<your id> in .env to preview in a browser.');
  process.exit(1);
}
const { app, handle } = await buildServer(env);
await handle.migrate();
serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, () =>
  console.log(`[preview] API on ${env.HOST}:${env.PORT} as Telegram user ${env.DEV_AUTH_TELEGRAM_ID} (bot not started)`),
);
