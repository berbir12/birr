/**
 * Registers the production webhook and command menu with Telegram. Run by scripts/build-vercel.mjs
 * on production builds only (preview deployments must never take over the bot).
 * Also validates the environment, so a misconfigured deploy fails at build time instead of at 2am.
 */
import { Api } from 'grammy';
import { BOT_COMMANDS } from './bot/index.js';
import { loadEnv } from './env.js';

const env = loadEnv();
if (env.BOT_MODE !== 'webhook') throw new Error('BOT_MODE must be "webhook" on Vercel');
if (!env.PUBLIC_URL.startsWith('https://')) throw new Error('PUBLIC_URL must be https:// on Vercel');
if (!env.DATABASE_URL?.startsWith('postgres')) throw new Error('DATABASE_URL must be the Supabase postgres:// URL');
if (!env.CRON_SECRET) console.warn('[setup] CRON_SECRET is not set: the daily cron will be rejected (401).');

const api = new Api(env.BOT_TOKEN);
const url = `${env.PUBLIC_URL}/telegram/webhook`;
await api.setWebhook(url, {
  secret_token: env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message', 'callback_query'],
});
await api.setMyCommands(BOT_COMMANDS);
const me = await api.getMe();
console.log(`[setup] @${me.username} → ${url}`);
