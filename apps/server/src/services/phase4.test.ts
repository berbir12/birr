import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { accounts, categories, imports, rawMessages, transactions } from '../db/schema.js';
import { useTestDb } from '../test/db.js';
import { commitImport, cancelImport, ImportError, previewImport } from './importer.js';
import { ingestBatch } from './ingest.js';
import { linkInternalTransfers, unlinkTransfer } from './postprocess.js';
import { getTx } from './transactions.js';
import { ensureUser } from './users.js';

const FIX = join(import.meta.dirname, '../../../../packages/parser/fixtures/sms');
const read = (dir: string) =>
  readdirSync(join(FIX, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => readFileSync(join(FIX, dir, f), 'utf8'));
const TELEBIRR = read('telebirr');
const CBE = read('cbe');

const encKey = randomBytes(32);
const t = useTestDb();
const deps = () => ({ db: t.db, encKey });
let userId: number;
const MIN = 60_000;
const T0 = Date.parse('2026-11-20T09:00:00+03:00');

/** Delivers SMS one at a time like the iPhone automation, a minute apart. */
async function webhook(bodies: string[], start = T0) {
  const out = [];
  for (const [k, body] of bodies.entries()) {
    out.push(...(await ingestBatch(deps(), userId, 'webhook', [{ body, receivedAt: start + k * MIN }])));
  }
  return out;
}
const rows = () => t.db.select().from(transactions).orderBy(transactions.occurredAt, transactions.id);

beforeEach(async () => {
  userId = (await ensureUser(t.db, 42, 'T')).id;
});

describe('balance reconciliation', () => {
  it('a complete history is ok after the first message', async () => {
    await webhook(CBE);
    const r = await rows();
    expect(r[0]!.reconciliation).toBe('unknown');
    expect(r.slice(1).every((x) => x.reconciliation === 'ok')).toBe(true);
  });

  it('flags a missing SMS, and clears the flag once it arrives', async () => {
    const missing = CBE[3]!; // c04: +173,697.00
    await webhook(CBE.slice(0, 3), T0);
    await webhook(CBE.slice(4), T0 + 10 * MIN);
    const gap = (await rows()).filter((x) => x.reconciliation === 'gap');
    expect(gap).toHaveLength(1);
    expect(gap[0]).toMatchObject({ amount: 1500000, reconciliationDelta: 17369700 }); // c05 is where it shows

    // The missing SMS turns up later (pasted), timed between the two.
    await ingestBatch(deps(), userId, 'bot', [{ body: missing, receivedAt: T0 + 5 * MIN }]);
    expect((await rows()).filter((x) => x.reconciliation === 'gap')).toHaveLength(0);
  });

  it('telebirr delivered one SMS at a time has no gaps', async () => {
    await webhook(TELEBIRR);
    expect((await rows()).filter((x) => x.reconciliation === 'gap')).toHaveLength(0);
  });

  it('the card explains a gap', async () => {
    await webhook([CBE[0]!, CBE[2]!]); // c02 missing between them
    const [, second] = await rows();
    const v = (await getTx(t.db, userId, second!.id))!;
    expect(v.reconciliation).toBe('gap');
    expect(v.reconciliationDelta).toBe(-348120); // 3,480.00 + 1.20 charges went out unrecorded
  });
});

describe('internal transfers', () => {
  it('links telebirr → bank with the matching CBE credit and moves both to Transfers', async () => {
    const tbToBank = TELEBIRR[9]!; // t10: 4,500.00 telebirr → bank at 24/11/2026 20:22:40
    const cbeCredit = CBE[0]!.replace('ETB 5,000.00', 'ETB 4,500.00').replace('Biniam Mulugeta Assefa', 'Abebe Kebede Alemu');
    await ingestBatch(deps(), userId, 'webhook', [{ body: tbToBank, receivedAt: Date.parse('2026-11-24T20:22:45+03:00') }]);
    await ingestBatch(deps(), userId, 'webhook', [{ body: cbeCredit, receivedAt: Date.parse('2026-11-24T20:24:10+03:00') }]);

    const [a, b] = await rows();
    expect(a!.transferGroupId).not.toBeNull();
    expect(a!.transferGroupId).toBe(b!.transferGroupId);
    const va = (await getTx(t.db, userId, a!.id))!;
    const vb = (await getTx(t.db, userId, b!.id))!;
    expect([va.categoryKey, vb.categoryKey]).toEqual(['transfers', 'transfers']);
    expect(va.transferPeerAccount).toBe('CBE ****4321');
    expect(vb.transferPeerAccount).toBe('telebirr');
  });

  it('CBE debit (ATM) → manual cash entry', async () => {
    const [o] = await ingestBatch(deps(), userId, 'webhook', [{ body: CBE[5]!, receivedAt: T0 }]); // c06: 1,600.00 debit
    if (o?.status !== 'created') throw new Error();
    const [cash] = await t.db.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.type, 'cash')));
    const [manual] = await t.db
      .insert(transactions)
      .values({ userId, accountId: cash!.id, channel: 'manual', source: 'cash', direction: 'in', kind: 'cash_in', amount: 160000, occurredAt: T0 + 3 * MIN })
      .returning();
    expect(await linkInternalTransfers(t.db, userId, [manual!.id])).toBe(1);
    const debit = (await getTx(t.db, userId, o.txId))!;
    const cashIn = (await getTx(t.db, userId, manual!.id))!;
    expect(debit.transferGroupId).not.toBeNull();
    expect(debit.transferGroupId).toBe(cashIn.transferGroupId);
    expect(debit.transferPeerAccount).toBe('Cash');
  });

  it('does not link payments to people that happen to match', async () => {
    // t11 sends 5,500.00 to Selam; a CBE credit of 5,500.00 from someone else arrives minutes later.
    await ingestBatch(deps(), userId, 'webhook', [{ body: TELEBIRR[10]!, receivedAt: Date.parse('2026-11-24T20:31:25+03:00') }]);
    const incoming = CBE[0]!.replace('ETB 5,000.00', 'ETB 5,500.00');
    await ingestBatch(deps(), userId, 'webhook', [{ body: incoming, receivedAt: Date.parse('2026-11-24T20:33:00+03:00') }]);
    expect((await rows()).every((x) => x.transferGroupId === null)).toBe(true);
  });

  it('keeps a category I chose, and can be unlinked', async () => {
    const tbToBank = TELEBIRR[9]!;
    const [o] = await ingestBatch(deps(), userId, 'webhook', [{ body: tbToBank, receivedAt: Date.parse('2026-11-24T20:22:45+03:00') }]);
    if (o?.status !== 'created') throw new Error();
    const [rent] = await t.db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.key, 'rent')));
    await t.db.update(transactions).set({ categoryId: rent!.id, confirmedAt: Date.now() }).where(eq(transactions.id, o.txId));

    const cbeCredit = CBE[0]!.replace('ETB 5,000.00', 'ETB 4,500.00');
    await ingestBatch(deps(), userId, 'webhook', [{ body: cbeCredit, receivedAt: Date.parse('2026-11-24T20:24:10+03:00') }]);
    const v = (await getTx(t.db, userId, o.txId))!;
    expect(v.transferGroupId).not.toBeNull();
    expect(v.categoryKey).toBe('rent');

    expect(await unlinkTransfer(t.db, userId, o.txId)).toBe(true);
    expect((await rows()).every((x) => x.transferGroupId === null)).toBe(true);
  });
});

describe('bulk ingest behaviour', () => {
  it('dry run returns exact counts and writes nothing', async () => {
    await ingestBatch(deps(), userId, 'bot', [{ body: CBE[0]!, receivedAt: T0 }]);
    const out = await ingestBatch(deps(), userId, 'import', CBE.map((body) => ({ body, receivedAt: T0 })), { dryRun: true });
    expect(out.filter((o) => o.status === 'created')).toHaveLength(9);
    expect(out.filter((o) => o.status === 'duplicate')).toHaveLength(1);
    expect(await t.db.select().from(transactions)).toHaveLength(1);
    expect(await t.db.select().from(rawMessages)).toHaveLength(1);
  });

  it('the same SMS twice in one batch is recorded once', async () => {
    const out = await ingestBatch(deps(), userId, 'bot', [TELEBIRR[0]!, TELEBIRR[1]!, TELEBIRR[0]!].map((body) => ({ body, receivedAt: T0 })));
    expect(out.map((o) => o.status)).toEqual(['created', 'created', 'duplicate']);
    expect(out[2]).toMatchObject({ txId: (out[0] as { txId: number }).txId });
    expect(await t.db.select().from(transactions)).toHaveLength(2);
  });

  it('keeps real per-message times from a backup file instead of estimating', async () => {
    const times = CBE.map((_, k) => T0 + k * 3_600_000);
    await ingestBatch(deps(), userId, 'import', CBE.map((body, k) => ({ body, receivedAt: times[k]! })));
    expect((await rows()).map((r) => r.occurredAt)).toEqual(times);
  });

  it('handles a large backfill in one call', async () => {
    // 2,000 distinct telebirr SMS (unique references) in one batch.
    const many = Array.from({ length: 2000 }, (_, k) =>
      TELEBIRR[0]!.replace(/DKN5AB1C01/g, `DKX${String(k).padStart(7, '0')}`).replace('23/11/2026 18:46:37', `23/11/2026 ${String(Math.floor(k / 60) % 24).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}:00`),
    );
    const started = Date.now();
    const out = await ingestBatch(deps(), userId, 'import', many.map((body) => ({ body, receivedAt: T0 })));
    expect(out.every((o) => o.status === 'created')).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);
});

describe('import lifecycle', () => {
  const xml = (bodies: Array<{ address: string; body: string; date: number }>) =>
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><smses count="${bodies.length}">` +
    bodies
      .map(
        (b) =>
          `<sms protocol="0" address="${b.address}" date="${b.date}" type="1" body="${b.body
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/\n/g, '&#10;')}" />`,
      )
      .join('') +
    `<sms protocol="0" address="+251911000000" date="${T0}" type="1" body="Lunch at 1?" /></smses>`;

  const file = () =>
    xml([
      ...TELEBIRR.map((body, k) => ({ address: '127', body, date: T0 + k * MIN })),
      ...CBE.map((body, k) => ({ address: 'CBE', body, date: T0 + k * MIN })),
      { address: '127', body: 'Dear customer, enjoy 50% bonus this weekend! telebirr', date: T0 },
    ]);

  it('preview counts, then commit imports exactly that', async () => {
    const { importId, summary } = await previewImport(deps(), userId, 'sms.xml', file());
    expect(summary).toMatchObject({
      format: 'xml',
      inFile: 23,
      relevant: 22,
      bySource: { telebirr: 12, cbe: 10 },
      created: 21,
      duplicates: 0,
      review: 1,
    });
    expect(await t.db.select().from(transactions)).toHaveLength(0);

    const r = await commitImport(deps(), userId, importId);
    expect(r.counts).toMatchObject({ created: 21, review: 1 });
    expect(await t.db.select().from(transactions)).toHaveLength(21);
    const [row] = await t.db.select().from(imports);
    expect(row!.status).toBe('committed');
    expect(row!.entriesEnc).toBeNull(); // SMS copies are dropped once imported
  });

  it('cannot be committed twice, after cancel, after expiry, or by another user', async () => {
    const a = await previewImport(deps(), userId, 'sms.xml', file());
    await commitImport(deps(), userId, a.importId);
    await expect(commitImport(deps(), userId, a.importId)).rejects.toBeInstanceOf(ImportError);

    const b = await previewImport(deps(), userId, 'sms.xml', file());
    expect(await cancelImport(t.db, userId, b.importId)).toBe(true);
    await expect(commitImport(deps(), userId, b.importId)).rejects.toBeInstanceOf(ImportError);

    const c = await previewImport(deps(), userId, 'sms.xml', file(), T0);
    await expect(commitImport(deps(), userId, c.importId, T0 + 2 * 60 * MIN)).rejects.toBeInstanceOf(ImportError);

    const other = await ensureUser(t.db, 43, 'Other');
    const d = await previewImport(deps(), userId, 'sms.xml', file());
    await expect(commitImport(deps(), other.id, d.importId)).rejects.toBeInstanceOf(ImportError);
  });

  it('a second preview of the same file shows everything as already recorded', async () => {
    const a = await previewImport(deps(), userId, 'sms.xml', file());
    await commitImport(deps(), userId, a.importId);
    const b = await previewImport(deps(), userId, 'sms.xml', file());
    expect(b.summary).toMatchObject({ created: 0, duplicates: 21, review: 1 });
  });

  it('stores pending SMS encrypted', async () => {
    await previewImport(deps(), userId, 'sms.xml', file());
    const [row] = await t.db.select().from(imports);
    expect(row!.entriesEnc!.toString('utf8')).not.toContain('Dear');
  });
});
