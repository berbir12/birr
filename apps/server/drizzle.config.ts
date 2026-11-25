import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` only diffs the schema file against previous migrations; it needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../drizzle',
  schemaFilter: ['birr'],
});
