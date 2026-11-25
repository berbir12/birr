/**
 * Bulk import: file → preview (exact counts, nothing saved) → commit or cancel.
 * Only SMS from telebirr/CBE are kept; everything else in a phone backup is dropped on read.
 */
import { detectSource, parseImportFile, parseSms, type ImportFormat } from '@birr/parser';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { decrypt, encrypt } from '../crypto.js';
import type { DB } from '../db/client.js';
import { imports } from '../db/schema.js';
import { ingestBatch, type IngestDeps, type IngestInput, type IngestOutcome } from './ingest.js';

export const IMPORT_TTL_MS = 60 * 60 * 1000;
export const MAX_IMPORT_MESSAGES = 20_000;

export interface ImportSummary {
  fileName: string;
  format: ImportFormat;
  /** Messages found in the file (all senders). */
  inFile: number;
  /** telebirr/CBE messages kept for import. */
  relevant: number;
  bySource: { telebirr: number; cbe: number };
  created: number;
  duplicates: number;
  review: number;
  /** Earliest/latest transaction time among relevant messages (unix ms), when known. */
  from: number | null;
  to: number | null;
}

export class ImportError extends Error {}

export function countOutcomes(outcomes: readonly IngestOutcome[]) {
  return {
    created: outcomes.filter((o) => o.status === 'created').length,
    duplicates: outcomes.filter((o) => o.status === 'duplicate').length,
    review: outcomes.filter((o) => o.status === 'review').length,
    ignored: outcomes.filter((o) => o.status === 'ignored').length,
  };
}

/** Keeps only messages that are from (or look like they're from) telebirr or CBE. */
function relevantInputs(entries: ReturnType<typeof parseImportFile>['entries'], now: number): IngestInput[] {
  return entries.flatMap((e) => {
    // A saved contact name ("Telebirr ⭐") isn't a known sender id; then let the body decide.
    const sender = e.sender && detectSource(e.sender, '') ? e.sender : null;
    if (!detectSource(sender, e.body)) return [];
    return [{ body: e.body, sender, receivedAt: e.receivedAt ?? now }];
  });
}

export async function previewImport(
  deps: IngestDeps,
  userId: number,
  fileName: string,
  content: string,
  now = Date.now(),
): Promise<{ importId: number; summary: ImportSummary }> {
  const { format, entries } = parseImportFile(fileName, content);
  const inputs = relevantInputs(entries, now);
  if (inputs.length > MAX_IMPORT_MESSAGES) {
    throw new ImportError(`That file has ${inputs.length} telebirr/CBE messages; the limit per import is ${MAX_IMPORT_MESSAGES}. Split it up.`);
  }

  const outcomes = inputs.length ? await ingestBatch(deps, userId, 'import', inputs, { dryRun: true }) : [];
  const counts = countOutcomes(outcomes);
  const bySource = { telebirr: 0, cbe: 0 };
  const times: number[] = [];
  for (const input of inputs) {
    const r = parseSms({ body: input.body, sender: input.sender });
    const src = r.ok ? r.tx.source : detectSource(input.sender, input.body);
    if (src) bySource[src]++;
    if (r.ok) times.push(r.tx.occurredAt ? Date.parse(r.tx.occurredAt) : input.receivedAt);
  }
  const summary: ImportSummary = {
    fileName,
    format,
    inFile: entries.length,
    relevant: inputs.length,
    bySource,
    created: counts.created,
    duplicates: counts.duplicates,
    review: counts.review,
    from: times.length ? Math.min(...times) : null,
    to: times.length ? Math.max(...times) : null,
  };

  const [row] = await deps.db
    .insert(imports)
    .values({
      userId,
      fileName,
      format,
      entriesEnc: encrypt(JSON.stringify(inputs), deps.encKey),
      summary: summary as unknown as Record<string, unknown>,
      expiresAt: now + IMPORT_TTL_MS,
    })
    .returning({ id: imports.id });
  return { importId: row!.id, summary };
}

async function pending(db: DB, userId: number, importId: number, now: number) {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.status, 'pending'), gt(imports.expiresAt, now)))
    .limit(1);
  if (!row?.entriesEnc) throw new ImportError('This import has expired or was already handled. Send the file again.');
  return row;
}

export async function commitImport(deps: IngestDeps, userId: number, importId: number, now = Date.now()) {
  const row = await pending(deps.db, userId, importId, now);
  // Claim it first so a double tap can't import twice.
  const claimed = await deps.db
    .update(imports)
    .set({ status: 'committed', entriesEnc: null })
    .where(and(eq(imports.id, importId), eq(imports.status, 'pending')))
    .returning({ id: imports.id });
  if (!claimed.length) throw new ImportError('This import is already being handled.');

  const inputs = JSON.parse(decrypt(row.entriesEnc!, deps.encKey)) as IngestInput[];
  try {
    const outcomes = await ingestBatch(deps, userId, 'import', inputs);
    return { outcomes, counts: countOutcomes(outcomes), summary: row.summary as unknown as ImportSummary };
  } catch (e) {
    // Put it back so it can be retried.
    await deps.db.update(imports).set({ status: 'pending', entriesEnc: row.entriesEnc }).where(eq(imports.id, importId));
    throw e;
  }
}

export async function cancelImport(db: DB, userId: number, importId: number): Promise<boolean> {
  const res = await db
    .update(imports)
    .set({ status: 'cancelled', entriesEnc: null })
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.status, 'pending')))
    .returning({ id: imports.id });
  return res.length > 0;
}

/** Cron housekeeping: forget the SMS of imports nobody confirmed. */
export async function purgeExpiredImports(db: DB, now = Date.now()): Promise<void> {
  await db
    .update(imports)
    .set({ status: 'cancelled', entriesEnc: null })
    .where(and(eq(imports.status, 'pending'), lt(imports.expiresAt, now)));
  await db.delete(imports).where(lt(imports.createdAt, sql`${now - 30 * 24 * 60 * 60 * 1000}`));
}
