/**
 * Vercel serverless entry. Bundled by scripts/build-vercel.mjs into .vercel/output/functions/api.func.
 * One instance handles many requests; the app, bot and DB pool are built once per cold start.
 * Migrations and webhook registration happen at build time, not here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';
import { restoreOriginalUrl } from './vercelUrl.js';

const env = loadEnv();
process.env.TZ = env.TZ;
if (env.BOT_MODE !== 'webhook') throw new Error('On Vercel BOT_MODE must be "webhook"');
if (!env.DATABASE_URL?.startsWith('postgres')) throw new Error('On Vercel DATABASE_URL must be a postgres:// URL');

const { app } = await buildServer(env);
const listener = getRequestListener(app.fetch);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = restoreOriginalUrl(req.url);
  return listener(req, res);
}
