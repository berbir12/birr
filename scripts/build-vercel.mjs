/**
 * Vercel build (Build Output API v3). Produces .vercel/output with:
 *   static/              the built Mini App
 *   functions/api.func/  the whole backend bundled into one Node function
 *   config.json          routes (+ SPA fallback), security headers, daily cron
 *
 * Production builds (VERCEL_ENV=production) also run DB migrations and register the
 * Telegram webhook + command menu. Preview builds never touch the database schema or the bot.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel', 'output');
const fn = join(out, 'functions', 'api.func');
const isProd = process.env.VERCEL_ENV === 'production' || process.env.BIRR_PROD_SETUP === '1';
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (isProd) {
  // Check every production setting before doing anything, so a misconfigured deploy fails with one clear list.
  console.log('==> Checking production settings');
  run('pnpm --filter @birr/server exec tsx src/setup-telegram.ts --check');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

console.log('==> Mini App');
run('pnpm --filter @birr/miniapp build');
cpSync(join(root, 'apps/miniapp/dist'), join(out, 'static'), { recursive: true });

if (isProd) {
  console.log('==> Migrations');
  run('pnpm --filter @birr/server db:migrate');
}

console.log('==> Backend function');
const esbuild = createRequire(join(root, 'apps/server/package.json'))('esbuild');
await esbuild.build({
  entryPoints: [join(root, 'apps/server/src/vercel.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // PGlite is only for local dev/tests and ships wasm assets; it is never loaded on Vercel.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator'],
  banner: { js: "import { createRequire as __birrCreateRequire } from 'node:module'; const require = __birrCreateRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
});
writeFileSync(
  join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 30,
      regions: ['fra1'],
    },
    null,
    2,
  ),
);

const security = {
  'content-security-policy': "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(.*)$', headers: security, continue: true },
        // Backend paths → the function. The original path travels in __birr_path so the app
        // routes correctly whether or not the platform rewrites req.url.
        { src: '^/((?:api|ingest|telegram|cron)(?:/.*)?|health)$', dest: '/api?__birr_path=/$1' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html', headers: { 'cache-control': 'no-cache' } },
      ],
      // 18:00 UTC = 21:00 Africa/Addis_Ababa. Hobby plan crons run once a day.
      crons: [{ path: '/cron/daily', schedule: '0 18 * * *' }],
    },
    null,
    2,
  ),
);

if (isProd) {
  console.log('==> Telegram webhook + commands');
  run('pnpm --filter @birr/server exec tsx src/setup-telegram.ts');
}

console.log(`==> Done (${isProd ? 'production' : 'preview'} build)`);
