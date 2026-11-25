import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt } from '../crypto.js';
import { accounts, categories, people, rawMessages, rules, transactions } from '../db/schema.js';
import { useTestDb } from '../test/db.js';
import { ingestBatch, reviewCount } from './ingest.js';
import { createRuleFromTx, getTx, setCategory, softDelete, undoLast } from './transactions.js';
import { ensureUser } from './users.js';

const FIX = join(import.meta.dirname, '../../../../packages/parser/fixtures/sms');
const read = (dir: string) =>
  readdirSync(join(FIX, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => readFileSync(join(FIX, dir, f), 'utf8'));
const TELEBIRR = read('telebirr'); // t01..t11, oldest first
const CBE = read('cbe'); // c01..c10, oldest first

const NOW = Date.parse('2026-11-24T21:00:00+03:00');
const encKey = randomBytes(32);
const t = useTestDb();
let userId: number;

const paste = (bodies: string[], at = NOW) =>
  ingestBatch({ db: t.db, encKey }, userId, 'bot', bodies.map((body) => ({ body, receivedAt: at })));
const created = (o: Awaited<ReturnType<typeof paste>>[number] | undefined) => {
  if (o?.status !== 'created') throw new Error(`expected created, got ${o?.status}`);
  return o.txId;
};

beforeEach(async () => {
  userId = (await ensureUser(t.db, 42, 'T')).id;
});

describe('ingestBatch', () => {
  it('records every fixture, newest-first paste like a phone SMS list', async () => {
    const out = await paste([...TELEBIRR].reverse().concat([...CBE].reverse()));
    expect(out.every((o) => o.status === 'created')).toBe(true);
    expect(await t.db.select().from(transactions)).toHaveLength(21);
  });

  it('creates one telebirr wallet and one CBE account with masked ids and latest balances', async () => {
    await paste([...TELEBIRR].reverse().concat([...CBE].reverse()));
    const accts = await t.db.select().from(accounts);
    const tb = accts.find((a) => a.type === 'telebirr')!;
    const cbe = accts.find((a) => a.type === 'cbe')!;
    expect(accts.map((a) => a.type).sort()).toEqual(['cash', 'cbe', 'telebirr']);
    expect(tb).toMatchObject({ maskedId: '****1111', balance: 41543 });
    expect(cbe).toMatchObject({ maskedId: '****4321', name: 'CBE ****4321', balance: 14937196 });
  });

  it('orders undated CBE messages by balance chain, not paste order', async () => {
    await paste([...CBE].reverse()); // newest first, all with the same received time
    const rows = await t.db.select().from(transactions).orderBy(transactions.occurredAt);
    expect(rows.map((r) => r.balanceAfter)).toEqual([
      545816, 197696, 496, 17370196, 15869836, 15709836, 15698636, 15198516, 14948396, 14937196,
    ]);
    expect(rows.every((r) => r.occurredAtEstimated)).toBe(true);
    expect(rows.at(-1)!.occurredAt).toBe(NOW);
  });

  it('is idempotent: pasting the same messages again creates nothing', async () => {
    await paste(TELEBIRR.concat(CBE));
    const again = await paste(TELEBIRR.concat(CBE), NOW + 3_600_000);
    expect(again.every((o) => o.status === 'duplicate')).toBe(true);
    expect(await t.db.select().from(transactions)).toHaveLength(21);
    expect(await t.db.select().from(rawMessages)).toHaveLength(21);
  });

  it('dedupes on reference even when whitespace differs (forwarded copy)', async () => {
    await paste([TELEBIRR[0]!]);
    const [o] = await paste([TELEBIRR[0]!.replace(/\s+/g, ' ')]);
    expect(o).toMatchObject({ status: 'duplicate' });
  });

  it('stores the raw SMS encrypted', async () => {
    await paste([CBE[0]!]);
    const [raw] = await t.db.select().from(rawMessages);
    expect(raw!.bodyEnc.toString('utf8')).not.toContain('Biniam');
    expect(decrypt(raw!.bodyEnc, encKey)).toBe(CBE[0]);
    expect(raw!.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies default categories by kind', async () => {
    await paste(TELEBIRR.concat(CBE));
    const byRef = async (ref: string) => {
      const [row] = await t.db.select().from(transactions).where(eq(transactions.reference, ref));
      return (await getTx(t.db, userId, row!.id))!.categoryKey;
    };
    expect(await byRef('DKO7AC0C10')).toBe('transfers'); // wallet → Awash
    expect(await byRef('DKO6AB9C09')).toBe('transfers'); // agent cash-in
    expect(await byRef('v2-FakeRcptToken0000c04')).toBe('income'); // received
    expect(await byRef('v2-FakeRcptToken0000c03')).toBe('other'); // generic debit
  });

  it('creates people once per counterparty, not for agents or banks', async () => {
    await paste(TELEBIRR.concat(CBE));
    const names = (await t.db.select().from(people)).map((p) => p.displayName);
    expect(names.filter((n) => n === 'Biniam Mulugeta Assefa')).toHaveLength(1); // c01 in, c08 out
    expect(names).toContain('Dawit Alemu'); // tidied from "DAWIT ALEMU"
    expect(names.some((n) => /agent|bank/i.test(n))).toBe(false);
  });

  it('ignores text that is not a known SMS and stores nothing', async () => {
    expect(await paste(['hello, how are you?'])).toEqual([{ status: 'ignored', reason: 'unknown_sender' }]);
    expect(await t.db.select().from(rawMessages)).toHaveLength(0);
  });

  it('sends unknown formats from a known sender to review, once', async () => {
    const promo = 'Dear customer, telebirr now offers 10% cashback on merchant payments. Ethio telecom';
    expect((await paste([promo]))[0]).toMatchObject({ status: 'review', reason: 'no_template', duplicate: false });
    expect((await paste([promo]))[0]).toMatchObject({ status: 'review', duplicate: true });
    expect(await reviewCount(t.db, userId)).toBe(1);
  });

  it('sends low-confidence parses to review with a candidate (never the raw text)', async () => {
    const bad = CBE[6]!.replace('total of ETB 112.00', 'total of ETB 113.00');
    expect((await paste([bad]))[0]).toMatchObject({ status: 'review', reason: 'low_confidence' });
    const [raw] = await t.db.select().from(rawMessages);
    expect(raw!.candidate).toMatchObject({ amount: 10000, kind: 'debit' });
    expect(JSON.stringify(raw!.candidate)).not.toContain('Dear');
    expect(await t.db.select().from(transactions)).toHaveLength(0);
  });

  it('re-ingesting a deleted transaction restores it', async () => {
    const id = created((await paste([TELEBIRR[3]!]))[0]);
    await softDelete(t.db, userId, id);
    expect((await paste([TELEBIRR[3]!]))[0]).toMatchObject({ status: 'duplicate', restored: true });
    expect((await getTx(t.db, userId, id))!.deletedAt).toBeNull();
  });

  it('keeps users apart: the same SMS for two users is two transactions', async () => {
    await paste([TELEBIRR[0]!]);
    const other = await ensureUser(t.db, 43, 'Partner');
    const [o] = await ingestBatch({ db: t.db, encKey }, other.id, 'bot', [{ body: TELEBIRR[0]!, receivedAt: NOW }]);
    expect(o).toMatchObject({ status: 'created' });
    expect(await getTx(t.db, userId, created(o))).toBeUndefined();
  });
});

describe('rules and undo', () => {
  const catId = async (key: string) =>
    (await t.db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.key, key))))[0]!.id;

  it('"always categorize" applies to past and future transactions, and undo reverts it', async () => {
    // c01 (in) and c08 (out) are both Biniam.
    const out = await paste([CBE[0]!, CBE[7]!]);
    const inTx = created(out[0]);
    const outTx = created(out[1]);
    const family = await catId('family');

    await setCategory(t.db, userId, outTx, family);
    const res = (await createRuleFromTx(t.db, userId, outTx, family))!;
    expect(res.updated).toBe(1); // the earlier incoming one
    expect((await getTx(t.db, userId, inTx))!.categoryKey).toBe('family');

    // Future messages from the same person follow the rule.
    const [next] = await paste([CBE[1]!.replace('Lemma Trading Plc', 'Biniam Mulugeta Assefa')]);
    expect((await getTx(t.db, userId, created(next)))!.categoryKey).toBe('family');

    // Undo goes newest first (ingestBatch itself logs nothing; the bot logs pastes).
    expect(await undoLast(t.db, userId)).toMatch(/rule/);
    expect(await t.db.select().from(rules)).toHaveLength(0);
    expect((await getTx(t.db, userId, inTx))!.categoryKey).toBe('income');
    expect((await getTx(t.db, userId, outTx))!.categoryKey).toBe('family'); // the manual recategorize is its own action
    expect(await undoLast(t.db, userId)).toMatch(/category/);
    expect((await getTx(t.db, userId, outTx))!.categoryKey).toBe('other');
  });

  it('undo delete restores', async () => {
    const id = created((await paste([TELEBIRR[0]!]))[0]);
    await softDelete(t.db, userId, id);
    expect(await undoLast(t.db, userId)).toMatch(/restored/);
    expect((await getTx(t.db, userId, id))!.deletedAt).toBeNull();
  });

  it('undo has nothing to do on a fresh user', async () => {
    expect(await undoLast(t.db, userId)).toBeNull();
  });
});
