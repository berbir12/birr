import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

/** Works with both drivers (postgres.js in production, PGlite in dev/tests). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle; usable anywhere a DB is. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(HERE, '../../../../drizzle');
export const DEFAULT_PGLITE_DIR = resolve(HERE, '../../../../data/pglite');

export interface DbHandle {
  db: DB;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * - `postgres://…` / `postgresql://…` → postgres.js (Supabase: use the pooler URL; prepared
 *   statements are disabled because the transaction pooler doesn't support them).
 * - `pglite://memory` → throwaway in-memory Postgres (tests).
 * - `pglite://<dir>` or unset → persistent PGlite in a local folder (dev, no server needed).
 */
export async function openDb(url: string | undefined): Promise<DbHandle> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const client = postgres(url, {
      prepare: false,
      max: process.env.VERCEL ? 1 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: local ? false : 'require',
      onnotice: () => {},
    });
    const db = drizzle({ client, schema }) as unknown as DB;
    return {
      db,
      migrate: () => migrate(db as never, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => client.end({ timeout: 5 }),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const target = url?.replace(/^pglite:\/\//, '') || DEFAULT_PGLITE_DIR;
  const inMemory = target === 'memory';
  if (!inMemory) mkdirSync(target, { recursive: true });
  const client = inMemory ? new PGlite() : new PGlite(target);
  const db = drizzle({ client, schema }) as unknown as DB;
  return {
    db,
    migrate: () => migrate(db as never, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}
