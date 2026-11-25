/** Applies pending migrations to DATABASE_URL (or the local PGlite folder when unset). */
import { openDb } from './client.js';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const handle = await openDb(url);
await handle.migrate();
await handle.close();
console.log(`Migrated ${url ? url.replace(/\/\/[^@]*@/, '//***@') : 'local PGlite'}`);
