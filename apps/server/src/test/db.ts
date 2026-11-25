/**
 * Test database: one in-memory Postgres (PGlite) per test file, migrated once, emptied before each
 * test. Booting PGlite takes ~1s, so per-test instances would make the suite crawl.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { openDb, type DB, type DbHandle } from '../db/client.js';

export function useTestDb(): { readonly db: DB } {
  let handle: DbHandle | undefined;
  const ref = {
    get db(): DB {
      if (!handle) throw new Error('test db not ready');
      return handle.db;
    },
  };

  beforeAll(async () => {
    handle = await openDb('pglite://memory');
    await handle.migrate();
  }, 30_000);

  beforeEach(async () => {
    const rows = (await handle!.db.execute(
      sql`select tablename from pg_tables where schemaname = 'birr'`,
    )) as unknown as { rows?: Array<{ tablename: string }> } & Array<{ tablename: string }>;
    const tables = (rows.rows ?? rows).map((r) => `birr."${r.tablename}"`);
    if (tables.length) await handle!.db.execute(sql.raw(`truncate ${tables.join(', ')} restart identity cascade`));
  });

  afterAll(async () => {
    await handle?.close();
  });

  return ref;
}
