/**
 * Production build steps (run by scripts/build-vercel.mjs, production builds only):
 *
 *   tsx src/setup-telegram.ts --check   validate every setting first, before anything else runs
 *   tsx src/setup-telegram.ts           register the webhook + command menu with Telegram
 *
 * Preview deployments must never take over the bot, so this never runs for them.
 */
import { Api } from 'grammy';
import { BOT_COMMANDS } from './bot/index.js';
import { loadEnv } from './env.js';

function fail(problems: string[]): never {
  console.error(
    [
      '',
      'Production settings are missing or invalid:',
      ...problems.map((p) => `  - ${p}`),
      '',
      'Fix them in Vercel → Project → Settings → Environment Variables (environment: Production),',
      'then Deployments → ⋯ → Redeploy. Variables only apply to deployments started after you save them.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// List every missing setting at once, so one redeploy fixes them all.
const REQUIRED = [
  'BOT_TOKEN',
  'ALLOWED_TELEGRAM_IDS',
  'DATABASE_URL',
  'DATA_ENCRYPTION_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
  'CRON_SECRET',
  'BOT_MODE',
];
const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
// PUBLIC_URL/MINIAPP_URL default to Vercel's production domain; only needed for a custom domain.
if (!process.env.PUBLIC_URL?.trim() && !process.env.VERCEL_PROJECT_PRODUCTION_URL) missing.push('PUBLIC_URL');
if (missing.length) fail(missing.map((k) => `${k} is not set`));

let env;
try {
  env = loadEnv();
} catch (e) {
  fail(
    (e as Error).message
      .replace(/^Invalid environment:\n/, '')
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, ''))
      .filter(Boolean),
  );
}

// PUBLIC_URL/MINIAPP_URL default to this project's production domain (see loadEnv); set them only
// for a custom domain.
const problems: string[] = [];
if (process.env.NODE_ENV !== 'production') problems.push(`NODE_ENV is "${process.env.NODE_ENV}"; set it to production`);
if (env.BOT_MODE !== 'webhook') problems.push(`BOT_MODE is "${env.BOT_MODE}"; set it to webhook`);
if (!env.TELEGRAM_WEBHOOK_SECRET) problems.push('TELEGRAM_WEBHOOK_SECRET is required');
if (!env.PUBLIC_URL.startsWith('https://')) {
  problems.push(`PUBLIC_URL is "${env.PUBLIC_URL}"; delete it in Vercel (it defaults to this project's address) or use an https:// custom domain`);
}
if (env.MINIAPP_URL.replace(/\/$/, '') !== env.PUBLIC_URL.replace(/\/$/, '')) {
  problems.push(`MINIAPP_URL is "${env.MINIAPP_URL}" but PUBLIC_URL is "${env.PUBLIC_URL}"; delete both in Vercel, or make them equal`);
}
if (!env.DATABASE_URL?.startsWith('postgres')) problems.push('DATABASE_URL must be the Supabase postgres:// connection string');
if (/\[YOUR-PASSWORD\]/i.test(env.DATABASE_URL ?? '')) problems.push('DATABASE_URL still contains [YOUR-PASSWORD]; put the real database password in');
if (env.ALLOWED_TELEGRAM_IDS.length === 0) problems.push('ALLOWED_TELEGRAM_IDS is empty; nobody could use the bot');
if (env.DEV_AUTH_TELEGRAM_ID !== undefined) problems.push('DEV_AUTH_TELEGRAM_ID must not be set in production');
if (!env.CRON_SECRET) problems.push('CRON_SECRET is required (the daily job is rejected without it)');
if (problems.length) fail(problems);

if (process.argv.includes('--check')) {
  console.log('[setup] production settings look complete');
  process.exit(0);
}

const api = new Api(env.BOT_TOKEN);
const url = `${env.PUBLIC_URL}/telegram/webhook`;
try {
  await api.setWebhook(url, { secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
  await api.setMyCommands(BOT_COMMANDS);
  const me = await api.getMe();
  console.log(`[setup] @${me.username} → ${url}`);
} catch (e) {
  fail([`Telegram rejected the bot token or webhook (${(e as Error).message}). Check BOT_TOKEN.`]);
}
