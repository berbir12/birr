import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSms } from '@birr/parser';
import { describe, expect, it } from 'vitest';
import { reconcile, type ReconTx } from './reconcile.js';
import { matchInternalTransfers, type TransferCandidate } from './transfers.js';

const FIX = join(import.meta.dirname, '../../parser/fixtures/sms');
function chain(dir: string): ReconTx[] {
  const parsed = readdirSync(join(FIX, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => {
      const r = parseSms({ body: readFileSync(join(FIX, dir, f), 'utf8') });
      if (!r.ok) throw new Error(f);
      return r.tx;
    });
  // Fixture files are numbered oldest → newest; CBE has no dates, so use the file order as time.
  return parsed.map((p, i) => ({ ...p, id: i + 1, occurredAt: p.occurredAt ? Date.parse(p.occurredAt) : i * 1000 }));
}

describe('reconcile (real SMS sequences)', () => {
  it.each(['telebirr', 'cbe'])('%s: a complete history is all ok after the first message', (dir) => {
    const res = reconcile(chain(dir));
    expect(res[0]!.status).toBe('unknown'); // nothing earlier to compare with
    expect(res.slice(1).every((r) => r.status === 'ok')).toBe(true);
  });

  it('flags exactly the interval where an SMS is missing, with the unexplained amount', () => {
    const full = chain('cbe');
    const missing = full[3]!; // c04: received 173,697.00 from Yared
    const res = reconcile(full.filter((t) => t !== missing));
    const gaps = res.filter((r) => r.status === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ id: full[4]!.id, status: 'gap', delta: 17369700, previousId: full[2]!.id });
  });

  it('a missing outgoing payment shows a negative delta', () => {
    const full = chain('telebirr');
    const res = reconcile(full.filter((t) => t.id !== 8)); // t08: 160.00 + 2.00 fees out
    expect(res.find((r) => r.status === 'gap')).toMatchObject({ id: 9, delta: -16200 });
  });

  it('one bad interval does not poison later ones (re-anchors on each reported balance)', () => {
    const full = chain('telebirr');
    const res = reconcile(full.filter((t) => t.id !== 2));
    expect(res.filter((r) => r.status === 'gap').map((r) => r.id)).toEqual([3]);
  });

  it('transactions without a balance carry into the expectation', () => {
    const base = { fee: 0, vat: 0, otherCharges: 0 };
    const res = reconcile([
      { id: 1, occurredAt: 1, direction: 'in', amount: 1000, balanceAfter: 1000, ...base },
      { id: 2, occurredAt: 2, direction: 'out', amount: 300, balanceAfter: null, ...base }, // e.g. manual cash
      { id: 3, occurredAt: 3, direction: 'out', amount: 200, balanceAfter: 500, ...base },
    ]);
    expect(res.map((r) => r.status)).toEqual(['unknown', 'unknown', 'ok']);
  });

  it('orders by time then id, regardless of input order', () => {
    const full = chain('cbe');
    expect(reconcile([...full].reverse()).slice(1).every((r) => r.status === 'ok')).toBe(true);
  });
});

describe('matchInternalTransfers', () => {
  const T0 = Date.parse('2026-11-24T10:00:00+03:00');
  const min = 60_000;
  const tx = (p: Partial<TransferCandidate> & Pick<TransferCandidate, 'id' | 'accountId' | 'direction' | 'kind'>): TransferCandidate => ({
    amount: 100000,
    occurredAt: T0,
    occurredAtEstimated: false,
    counterpartyName: null,
    transferGroupId: null,
    ...p,
  });
  const CBE = 1;
  const TELEBIRR = 2;
  const CASH = 3;

  it('pairs a CBE debit with a telebirr credit of the same amount minutes later', () => {
    const pairs = matchInternalTransfers([
      tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit', occurredAtEstimated: true }),
      tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'bank_to_wallet', occurredAt: T0 + 2 * min }),
    ]);
    expect(pairs).toEqual([[1, 2]]);
  });

  it('pairs telebirr → bank with the bank credit', () => {
    const pairs = matchInternalTransfers([
      tx({ id: 1, accountId: TELEBIRR, direction: 'out', kind: 'wallet_to_bank', counterpartyName: 'Commercial Bank of Ethiopia' }),
      tx({ id: 2, accountId: CBE, direction: 'in', kind: 'transfer_in', occurredAt: T0 + min, occurredAtEstimated: true }),
    ]);
    expect(pairs).toEqual([[1, 2]]);
  });

  it('ATM withdrawal → manual cash entry', () => {
    const pairs = matchInternalTransfers([
      tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit' }),
      tx({ id: 2, accountId: CASH, direction: 'in', kind: 'cash_in', occurredAt: T0 + 10 * min }),
    ]);
    expect(pairs).toEqual([[1, 2]]);
  });

  it('does not pair person-to-person transfers that happen to match', () => {
    const pairs = matchInternalTransfers([
      tx({ id: 1, accountId: CBE, direction: 'out', kind: 'transfer_out', counterpartyName: 'Abebe Kebede' }),
      tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'transfer_in', counterpartyName: 'Selam Bekele', occurredAt: T0 + min }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('requires the same amount, different accounts, and the time window', () => {
    expect(
      matchInternalTransfers([
        tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit' }),
        tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'credit', amount: 99999 }),
        tx({ id: 3, accountId: CBE, direction: 'in', kind: 'credit' }),
        tx({ id: 4, accountId: TELEBIRR, direction: 'in', kind: 'credit', occurredAt: T0 + 45 * min }),
      ]),
    ).toEqual([]);
  });

  it('uses a wider window when a time is estimated (CBE)', () => {
    const legs = [
      tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit', occurredAtEstimated: true }),
      tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'credit', occurredAt: T0 + 3 * 60 * min }),
    ];
    expect(matchInternalTransfers(legs)).toEqual([[1, 2]]);
  });

  it('the incoming leg cannot be long before the outgoing one', () => {
    expect(
      matchInternalTransfers([
        tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit' }),
        tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'credit', occurredAt: T0 - 20 * min }),
      ]),
    ).toEqual([]);
  });

  it('each leg is used once; the closest pair wins', () => {
    const pairs = matchInternalTransfers([
      tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit' }),
      tx({ id: 2, accountId: CBE, direction: 'out', kind: 'debit', occurredAt: T0 + 9 * min }),
      tx({ id: 3, accountId: TELEBIRR, direction: 'in', kind: 'credit', occurredAt: T0 + 10 * min }),
    ]);
    expect(pairs).toEqual([[2, 3]]);
  });

  it('skips transactions that are already linked', () => {
    expect(
      matchInternalTransfers([
        tx({ id: 1, accountId: CBE, direction: 'out', kind: 'debit', transferGroupId: 'g1' }),
        tx({ id: 2, accountId: TELEBIRR, direction: 'in', kind: 'credit' }),
      ]),
    ).toEqual([]);
  });
});
