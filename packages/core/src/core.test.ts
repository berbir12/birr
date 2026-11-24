import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSms } from '@birr/parser';
import { formatEtb, tidyName } from '@birr/shared';
import { describe, expect, it } from 'vitest';
import { categorize, ruleFor, type Rule } from './categorize.js';
import { balanceDelta, orderByBalanceChain } from './order.js';

const FIX = join(import.meta.dirname, '../../parser/fixtures/sms');
function parsedDir(dir: string) {
  return readdirSync(join(FIX, dir))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => {
      const r = parseSms({ body: readFileSync(join(FIX, dir, f), 'utf8') });
      if (!r.ok) throw new Error(f);
      return r.tx;
    });
}

describe('categorize', () => {
  const base = { direction: 'out' as const, counterpartyMaskedId: null };

  it('user rule beats everything', () => {
    const rules: Rule[] = [{ field: 'counterparty_name', pattern: 'selam bekele', categoryKey: 'family', priority: 100 }];
    const r = categorize({ ...base, kind: 'transfer_out', counterpartyName: 'SELAM  Bekele' }, rules);
    expect(r).toEqual({ categoryKey: 'family', via: 'rule' });
  });

  it('lower priority number wins between rules', () => {
    const rules: Rule[] = [
      { field: 'text', pattern: 'trading', categoryKey: 'business', priority: 200 },
      { field: 'counterparty_name', pattern: 'lemma trading plc', categoryKey: 'shopping', priority: 100 },
    ];
    expect(categorize({ ...base, kind: 'transfer_out', counterpartyName: 'Lemma Trading Plc' }, rules).categoryKey).toBe('shopping');
  });

  it('keyword hints for Ethiopian merchants', () => {
    expect(categorize({ ...base, kind: 'merchant_payment', counterpartyName: 'Ethiopian Electric Utility' }, []).categoryKey).toBe('utilities');
    expect(categorize({ ...base, kind: 'merchant_payment', counterpartyName: 'Feres Transport' }, []).categoryKey).toBe('transport');
  });

  it('kind defaults: own-money moves are transfers, income is income', () => {
    expect(categorize({ ...base, kind: 'wallet_to_bank', counterpartyName: 'Awash International Bank S C' }, []).categoryKey).toBe('transfers');
    expect(categorize({ ...base, kind: 'cash_in', counterpartyName: 'telebirr agent 12345' }, []).categoryKey).toBe('transfers');
    expect(categorize({ ...base, direction: 'in', kind: 'transfer_in', counterpartyName: 'Yared' }, []).categoryKey).toBe('income');
  });

  it('falls back to other', () => {
    expect(categorize({ ...base, kind: 'debit', counterpartyName: null }, [])).toEqual({ categoryKey: 'other', via: 'fallback' });
  });

  it('ruleFor prefers the name, normalised', () => {
    expect(ruleFor({ ...base, kind: 'transfer_out', counterpartyName: ' Selam  Bekele ' })).toEqual({
      field: 'counterparty_name',
      pattern: 'selam bekele',
    });
    expect(ruleFor({ ...base, kind: 'debit', counterpartyName: null })).toBeNull();
  });
});

describe('balanceDelta', () => {
  it('includes all charges', () => {
    expect(balanceDelta({ direction: 'out', amount: 10000, fee: 1000, vat: 150, otherCharges: 50 })).toBe(-11200);
    expect(balanceDelta({ direction: 'in', amount: 500000, fee: 0, vat: 0, otherCharges: 0 })).toBe(500000);
  });
});

describe('orderByBalanceChain (real CBE sequence, no dates in SMS)', () => {
  const cbe = parsedDir('cbe'); // c01..c10 are oldest → newest

  it('restores chronological order from a newest-first paste', () => {
    const pasted = [...cbe].reverse();
    const order = orderByBalanceChain(pasted);
    expect(order.map((i) => pasted[i]!.balanceAfter)).toEqual(cbe.map((t) => t.balanceAfter));
  });

  it('restores order from a random shuffle', () => {
    const shuffled = [cbe[4], cbe[0], cbe[9], cbe[2], cbe[7], cbe[1], cbe[8], cbe[3], cbe[6], cbe[5]].map((t) => t!);
    const order = orderByBalanceChain(shuffled);
    expect(order.map((i) => shuffled[i]!.reference)).toEqual(cbe.map((t) => t.reference));
  });

  it('keeps every item even when there is a gap', () => {
    const withGap = [...cbe.slice(0, 3), ...cbe.slice(5)].reverse(); // c04, c05 missing
    const order = orderByBalanceChain(withGap);
    expect([...order].sort((a, b) => a - b)).toEqual(withGap.map((_, i) => i));
    // The two sub-chains are each internally ordered.
    const refs = order.map((i) => withGap[i]!.reference);
    expect(refs.indexOf(cbe[0]!.reference)).toBeLessThan(refs.indexOf(cbe[2]!.reference));
    expect(refs.indexOf(cbe[5]!.reference)).toBeLessThan(refs.indexOf(cbe[9]!.reference));
  });

  it('telebirr sequence also chains', () => {
    const tb = parsedDir('telebirr').sort((a, b) => a.occurredAt!.localeCompare(b.occurredAt!));
    for (let i = 1; i < tb.length; i++) {
      expect(tb[i - 1]!.balanceAfter! + balanceDelta(tb[i]!)).toBe(tb[i]!.balanceAfter);
    }
  });
});

describe('format', () => {
  it('formatEtb', () => {
    expect(formatEtb(550000)).toBe('ETB 5,500.00');
    expect(formatEtb(-87)).toBe('−ETB 0.87');
    expect(formatEtb(100, { sign: true })).toBe('+ETB 1.00');
  });
  it('tidyName', () => {
    expect(tidyName('DAWIT ALEMU')).toBe('Dawit Alemu');
    expect(tidyName('Tesfaye W/mariam Desta')).toBe('Tesfaye W/mariam Desta');
    expect(tidyName('TIGIST W/GIORGIS')).toBe('Tigist W/Giorgis');
  });
});
