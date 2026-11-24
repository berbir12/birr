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

  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN is required (from @BotFather)'),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  ALLOWED_TELEGRAM_IDS: csvIds,

  DATABASE_PATH: z.string().default('./data/birr.db'),
  /** 32 bytes, base64. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  TZ: z.string().default('Africa/Addis_Ababa'),

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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
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
  if (env.ALLOWED_TELEGRAM_IDS.length === 0) {
    console.warn('[env] ALLOWED_TELEGRAM_IDS is empty: every user will be rejected.');
  }
  return env;
}
