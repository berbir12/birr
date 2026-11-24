import { serveStatic } from '@hono/node-server/serve-static';
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
  /** Absolute path of the built Mini App to serve from this server (when there is no Caddy). */
  miniappDir?: string;
}

export type AppEnv = { Variables: { user: User } };

export function createApp(deps: AppDeps) {
  const { db, env } = deps;
  const app = new Hono();

  // Telegram Web (web.telegram.org) shows Mini Apps in an iframe, so framing must be allowed
  // for Telegram's origins only.
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: false,
      contentSecurityPolicy: { frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'] },
    }),
  );
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
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  app.all('/ingest/*', (c) => c.json({ error: 'not_found' }, 404));

  // ---- Mini App static files (Windows/self-hosting without Caddy) ----
  if (deps.miniappDir) {
    const root = deps.miniappDir;
    // Vite's hashed assets never change; index.html must always be revalidated.
    // (Set after the handler runs: serveStatic builds its Response before onFound fires.)
    app.use('*', async (c, next) => {
      await next();
      if (c.req.method !== 'GET' || c.res.status !== 200) return;
      const type = c.res.headers.get('content-type') ?? '';
      if (c.req.path.startsWith('/assets/')) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      else if (type.includes('text/html')) c.res.headers.set('Cache-Control', 'no-cache');
    });
    app.use('*', serveStatic({ root }));
    // SPA fallback: unknown paths get index.html so client-side routes load.
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }
  return app;
}
