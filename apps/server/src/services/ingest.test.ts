import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt } from '../crypto.js';
import { openDb, runMigrations, type DB } from '../db/client.js';
import { accounts, people, rawMessages, rules, transactions } from '../db/schema.js';
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
let db: DB;
let userId: number;

const paste = (bodies: string[], at = NOW) =>
  ingestBatch({ db, encKey }, userId, 'bot', bodies.map((body) => ({ body, receivedAt: at })));

beforeEach(() => {
  db = openDb(':memory:').db;
  runMigrations(db);
  userId = ensureUser(db, 42, 'T').id;
});

describe('ingestBatch', () => {
  it('records every fixture, newest-first paste like a phone SMS list', () => {
    const out = paste([...TELEBIRR].reverse().concat([...CBE].reverse()));
    expect(out.every((o) => o.status === 'created')).toBe(true);
    expect(db.select().from(transactions).all()).toHaveLength(21);
  });

  it('creates one telebirr wallet and one CBE account with masked ids and latest balances', () => {
    paste([...TELEBIRR].reverse().concat([...CBE].reverse()));
    const accts = db.select().from(accounts).all();
    const tb = accts.find((a) => a.type === 'telebirr')!;
    const cbe = accts.find((a) => a.type === 'cbe')!;
    expect(accts.map((a) => a.type).sort()).toEqual(['cash', 'cbe', 'telebirr']);
    expect(tb).toMatchObject({ maskedId: '****1111', balance: 41543 });
    expect(cbe).toMatchObject({ maskedId: '****4321', name: 'CBE ****4321', balance: 14937196 });
  });

  it('orders undated CBE messages by balance chain, not paste order', () => {
    paste([...CBE].reverse()); // newest first, all with the same received time
    const rows = db.select().from(transactions).orderBy(transactions.occurredAt).all();
    expect(rows.map((r) => r.balanceAfter)).toEqual([545816, 197696, 496, 17370196, 15869836, 15709836, 15698636, 15198516, 14948396, 14937196]);
    expect(rows.every((r) => r.occurredAtEstimated)).toBe(true);
    expect(rows.at(-1)!.occurredAt).toBe(NOW);
  });

  it('is idempotent: pasting the same messages again creates nothing', () => {
    paste(TELEBIRR.concat(CBE));
    const again = paste(TELEBIRR.concat(CBE), NOW + 3_600_000);
    expect(again.every((o) => o.status === 'duplicate')).toBe(true);
    expect(db.select().from(transactions).all()).toHaveLength(21);
    expect(db.select().from(rawMessages).all()).toHaveLength(21);
  });

  it('dedupes on reference even when whitespace differs (forwarded copy)', () => {
    paste([TELEBIRR[0]!]);
    const [o] = paste([TELEBIRR[0]!.replace(/\s+/g, ' ')]);
    expect(o).toMatchObject({ status: 'duplicate' });
  });

  it('stores the raw SMS encrypted', () => {
    paste([CBE[0]!]);
    const raw = db.select().from(rawMessages).get()!;
    expect(raw.bodyEnc.toString('utf8')).not.toContain('Biniam');
    expect(decrypt(raw.bodyEnc, encKey)).toBe(CBE[0]);
    expect(raw.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies default categories by kind', () => {
    paste(TELEBIRR.concat(CBE));
    const byRef = (ref: string) => {
      const t = db.select().from(transactions).where(eq(transactions.reference, ref)).get()!;
      return getTx(db, userId, t.id)!.categoryKey;
    };
    expect(byRef('DKO7AC0C10')).toBe('transfers'); // wallet → Awash
    expect(byRef('DKO6AB9C09')).toBe('transfers'); // agent cash-in
    expect(byRef('v2-FakeRcptToken0000c04')).toBe('income'); // received
    expect(byRef('v2-FakeRcptToken0000c03')).toBe('other'); // generic debit
  });

  it('creates people once per counterparty, not for agents or banks', () => {
    paste(TELEBIRR.concat(CBE));
    const names = db.select().from(people).all().map((p) => p.displayName);
    expect(names.filter((n) => n === 'Biniam Mulugeta Assefa')).toHaveLength(1); // c01 in, c08 out
    expect(names).toContain('Dawit Alemu'); // tidied from "DAWIT ALEMU"
    expect(names.some((n) => /agent|bank/i.test(n))).toBe(false);
  });

  it('ignores text that is not a known SMS and stores nothing', () => {
    expect(paste(['hello, how are you?'])).toEqual([{ status: 'ignored', reason: 'unknown_sender' }]);
    expect(db.select().from(rawMessages).all()).toHaveLength(0);
  });

  it('sends unknown formats from a known sender to review, once', () => {
    const promo = 'Dear customer, telebirr now offers 10% cashback on merchant payments. Ethio telecom';
    expect(paste([promo])[0]).toMatchObject({ status: 'review', reason: 'no_template', duplicate: false });
    expect(paste([promo])[0]).toMatchObject({ status: 'review', duplicate: true });
    expect(reviewCount(db, userId)).toBe(1);
  });

  it('sends low-confidence parses to review with a candidate (never the raw text)', () => {
    const bad = CBE[6]!.replace('total of ETB 112.00', 'total of ETB 113.00');
    expect(paste([bad])[0]).toMatchObject({ status: 'review', reason: 'low_confidence' });
    const raw = db.select().from(rawMessages).get()!;
    expect(raw.candidate).toMatchObject({ amount: 10000, kind: 'debit' });
    expect(JSON.stringify(raw.candidate)).not.toContain('Dear');
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('re-ingesting a deleted transaction restores it', () => {
    const [o] = paste([TELEBIRR[3]!]);
    if (o?.status !== 'created') throw new Error();
    softDelete(db, userId, o.txId);
    expect(paste([TELEBIRR[3]!])[0]).toMatchObject({ status: 'duplicate', restored: true });
    expect(getTx(db, userId, o.txId)!.deletedAt).toBeNull();
  });
});

describe('rules and undo', () => {
  const catId = (key: string) => db.query.categories.findFirst({ where: (c, { and, eq }) => and(eq(c.userId, userId), eq(c.key, key)) }).sync()!.id;

  it('"always categorize" applies to past and future transactions, and undo reverts it', () => {
    // c01 (in) and c08 (out) are both Biniam.
    const out = paste([CBE[0]!, CBE[7]!]);
    const [inTx, outTx] = out.map((o) => (o.status === 'created' ? o.txId : -1));
    const family = catId('family');

    setCategory(db, userId, outTx!, family);
    const res = createRuleFromTx(db, userId, outTx!, family)!;
    expect(res.updated).toBe(1); // the earlier incoming one
    expect(getTx(db, userId, inTx!)!.categoryKey).toBe('family');

    // Future messages from the same person follow the rule.
    const [next] = paste([CBE[1]!.replace('Lemma Trading Plc', 'Biniam Mulugeta Assefa')]);
    expect(next?.status === 'created' && getTx(db, userId, next.txId)!.categoryKey).toBe('family');

    // Undo goes newest first (ingestBatch itself logs nothing; the bot logs pastes).
    expect(undoLast(db, userId)).toMatch(/rule/);
    expect(db.select().from(rules).all()).toHaveLength(0);
    expect(getTx(db, userId, inTx!)!.categoryKey).toBe('income');
    expect(getTx(db, userId, outTx!)!.categoryKey).toBe('family'); // the manual recategorize is its own action
    expect(undoLast(db, userId)).toMatch(/category/);
    expect(getTx(db, userId, outTx!)!.categoryKey).toBe('other');
  });

  it('undo delete restores', () => {
    const [o] = paste([TELEBIRR[0]!]);
    if (o?.status !== 'created') throw new Error();
    softDelete(db, userId, o.txId);
    expect(undoLast(db, userId)).toMatch(/restored/);
    expect(getTx(db, userId, o.txId)!.deletedAt).toBeNull();
  });

  it('undo has nothing to do on a fresh user', () => {
    expect(undoLast(db, userId)).toBeNull();
  });
});
