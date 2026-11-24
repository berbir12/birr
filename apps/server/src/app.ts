import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { isAllowed } from './auth/allowlist.js';
import { validateInitData } from './auth/initData.js';
import type { DB } from './db/client.js';
import type { Env } from './env.js';
import { ingestRoutes, type Notify } from './routes/ingest.js';
import { ensureUser, type User } from './services/users.js';

export interface AppDeps {
  db: DB;
  env: Env;
  encKey: Buffer;
  /** Sends confirmation cards for webhook-ingested SMS (the bot). */
  notify?: Notify;
}

export type AppEnv = { Variables: { user: User } };

export function createApp(deps: AppDeps) {
  const { db, env } = deps;
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use('*', bodyLimit({ maxSize: 20 * 1024 * 1024 }));
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/ingest', ingestRoutes(deps));

  // ---- Mini App API: every request must carry valid initData ----
  const api = new Hono<AppEnv>();
  api.use('*', cors({ origin: env.MINIAPP_URL, allowHeaders: ['Authorization', 'Content-Type'] }));
  api.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const [scheme, initData] = header.split(' ', 2);
    if (scheme !== 'tma' || !initData) return c.json({ error: 'unauthorized' }, 401);

    const result = validateInitData(initData, env.BOT_TOKEN, env.INITDATA_MAX_AGE_SECONDS);
    if (!result.ok) return c.json({ error: 'unauthorized', reason: result.reason }, 401);
    if (!isAllowed(result.user.id, env.ALLOWED_TELEGRAM_IDS)) return c.json({ error: 'forbidden' }, 403);

    c.set('user', ensureUser(db, result.user.id, result.user.first_name));
    await next();
  });

  api.get('/me', (c) => {
    const u = c.get('user');
    return c.json({
      id: u.id,
      firstName: u.firstName,
      locale: u.locale,
      calendarMode: u.calendarMode,
      timezone: u.timezone,
    });
  });

  app.route('/api', api);
  return app;
}
