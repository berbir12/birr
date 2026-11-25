import { z } from 'zod';

const csvIds = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        if (!/^\d+$/.test(x)) throw new Error(`ALLOWED_TELEGRAM_IDS: "${x}" is not a numeric id`);
        return Number(x);
      }),
  );

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  /** Bind address. 127.0.0.1 keeps the API reachable only through Caddy on the same machine. */
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.url().default('http://localhost:8787'),
  MINIAPP_URL: z.url().default('http://localhost:5173'),
  /** Serve the built Mini App (apps/miniapp/dist) from this server. For hosting without Caddy, e.g. on Windows. */
  SERVE_MINIAPP: bool,

  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN is required (from @BotFather)'),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  ALLOWED_TELEGRAM_IDS: csvIds,

  /** Supabase pooler URL (postgres://…:6543/postgres). Unset = local PGlite folder (dev). 'pglite://memory' for tests. */
  DATABASE_URL: z.string().optional(),
  /** Vercel sends this as 'Authorization: Bearer <CRON_SECRET>' to cron endpoints. */
  CRON_SECRET: z.string().min(16).optional(),
  /** 32 bytes, base64. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  TZ: z.string().default('Africa/Addis_Ababa'),

  /**
   * Local development only: Mini App requests without Telegram initData are treated as this
   * (allowlisted) Telegram user, so the app can be opened in a normal browser. Refused outside
   * NODE_ENV=development and on Vercel.
   */
  DEV_AUTH_TELEGRAM_ID: z.coerce.number().int().positive().optional(),

  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),

  LLM_FALLBACK_ENABLED: bool,
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-haiku-5-5'),
  LLM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),

  LARGE_TX_THRESHOLD_ETB: z.coerce.number().nonnegative().default(5000),
  LOW_BALANCE_THRESHOLD_ETB: z.coerce.number().nonnegative().default(500),
  DIGEST_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('21:00'),
});

export type Env = z.infer<typeof schema>;

/** Replaced at bundle time by scripts/build-vercel.mjs (esbuild `define`); empty everywhere else. */
declare const __BIRR_PRODUCTION_HOST__: string | undefined;
const BUILT_PRODUCTION_HOST: string | undefined =
  typeof __BIRR_PRODUCTION_HOST__ === 'string' && __BIRR_PRODUCTION_HOST__ ? __BIRR_PRODUCTION_HOST__ : undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file (or an empty Vercel variable) means "not set", not "empty string".
  const cleaned: Record<string, string> = Object.fromEntries(
    Object.entries(source).filter((e): e is [string, string] => e[1] !== undefined && e[1].trim() !== ''),
  );
  // On Vercel, default both URLs to the project's production domain, which Vercel provides itself
  // (and which the build also bakes in), so nobody has to know the URL before the first deploy.
  const vercelHost = cleaned.VERCEL_PROJECT_PRODUCTION_URL ?? BUILT_PRODUCTION_HOST;
  if (vercelHost && (cleaned.VERCEL || BUILT_PRODUCTION_HOST)) {
    const url = `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    cleaned.PUBLIC_URL ??= url;
    cleaned.MINIAPP_URL ??= cleaned.PUBLIC_URL;
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.BOT_MODE === 'webhook' && !env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is required when BOT_MODE=webhook');
  }
  if (env.LLM_FALLBACK_ENABLED && !env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when LLM_FALLBACK_ENABLED=true');
  }
  if (env.DEV_AUTH_TELEGRAM_ID !== undefined) {
    if (env.NODE_ENV !== 'development' || cleaned.VERCEL) {
      throw new Error('DEV_AUTH_TELEGRAM_ID is for local development only; remove it (NODE_ENV must be development, not on Vercel).');
    }
    if (!env.ALLOWED_TELEGRAM_IDS.includes(env.DEV_AUTH_TELEGRAM_ID)) {
      throw new Error('DEV_AUTH_TELEGRAM_ID must also be in ALLOWED_TELEGRAM_IDS.');
    }
  }
  if (env.ALLOWED_TELEGRAM_IDS.length === 0) {
    console.warn('[env] ALLOWED_TELEGRAM_IDS is empty: every user will be rejected.');
  }
  return env;
}
