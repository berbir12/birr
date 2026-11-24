import { openDb, runMigrations } from './client.js';

const path = process.env.DATABASE_PATH ?? './data/birr.db';
const { db, sqlite } = openDb(path);
runMigrations(db);
sqlite.close();
console.log(`Migrated ${path}`);
