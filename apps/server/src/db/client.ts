import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../drizzle');

export function openDb(path: string): { db: DB; sqlite: Database.Database } {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function runMigrations(db: DB): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
