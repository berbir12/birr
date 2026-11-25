/** Applies pending migrations to DATABASE_URL (or the local PGlite folder when unset, in development). */
import { openDb } from './client.js';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
// On Vercel there is no local database: migrating a throwaway PGlite would "succeed" and hide the problem.
if (process.env.VERCEL && !url?.startsWith('postgres')) {
  console.error('DATABASE_URL is not set to a postgres:// URL in this Vercel environment; refusing to migrate.');
  process.exit(1);
}
const handle = await openDb(url);
await handle.migrate();
await handle.close();
console.log(`Migrated ${url ? url.replace(/\/\/[^@]*@/, '//***@') : 'local PGlite'}`);
