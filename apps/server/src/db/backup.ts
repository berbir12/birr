/**
 * Consistent online backup of the SQLite database (safe while the server is running).
 *   docker compose exec server ./node_modules/.bin/tsx src/db/backup.ts
 * Writes /data/backups/birr-<timestamp>.db and keeps the newest KEEP files.
 * Raw SMS bodies stay encrypted in the backup; keep DATA_ENCRYPTION_KEY somewhere safe separately.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const KEEP = Number(process.env.BACKUP_KEEP ?? 14);
const dbPath = resolve(process.env.DATABASE_PATH ?? './data/birr.db');
const dir = join(dirname(dbPath), 'backups');
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(dir, `birr-${stamp}.db`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
await db.backup(out);
db.close();

const old = readdirSync(dir)
  .filter((f) => /^birr-.*\.db$/.test(f))
  .sort()
  .reverse()
  .slice(KEEP);
for (const f of old) rmSync(join(dir, f));

console.log(`Backup written: ${out}${old.length ? ` (removed ${old.length} old)` : ''}`);
