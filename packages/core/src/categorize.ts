import type { TransactionKind } from '@birr/shared';

export interface CategorizableTx {
  kind: TransactionKind | string;
  direction: 'in' | 'out';
  counterpartyName: string | null;
  counterpartyMaskedId: string | null;
}

export interface Rule {
  field: 'counterparty_name' | 'counterparty_masked_id' | 'kind' | 'text';
  pattern: string;
  categoryKey: string;
  priority: number;
}

/** Category used when nothing else matches, by transaction kind. */
const KIND_DEFAULTS: Partial<Record<TransactionKind, string>> = {
  airtime: 'airtime',
  data_package: 'airtime',
  bill_payment: 'utilities',
  fee_only: 'fees',
  salary: 'income',
  credit: 'income',
  transfer_in: 'income',
  reversal: 'income',
  // Moving my own money around is not spending.
  cash_in: 'transfers',
  cash_out: 'transfers',
  bank_to_wallet: 'transfers',
  wallet_to_bank: 'transfers',
};

/** Ethiopian-context keyword hints on the counterparty name. Lower priority than user rules. */
const KEYWORD_HINTS: Array<[RegExp, string]> = [
  [/\b(ethiopian electric|EEU|EEPCO)\b/i, 'utilities'],
  [/\bwater (supply|and sewerage)|AAWSA\b/i, 'utilities'],
  [/\bethio ?telecom\b/i, 'airtime'],
  [/\b(ride|feres|zayride|yango|taxi|fuel|total ?energies|noc|oil libya)\b/i, 'transport'],
  [/\b(church|mosque|masjid|bete ?kristiyan|tewahedo|mesgid)\b/i, 'giving'],
  [/\b(equb|iddir|edir|ekub)\b/i, 'equb'],
  [/\b(hospital|clinic|pharmacy|medical|health)\b/i, 'health'],
  [/\b(school|academy|college|university)\b/i, 'education'],
  [/\b(supermarket|market|bakery|cafe|restaurant|butchery|shemach)\b/i, 'food'],
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Rule pattern for "always categorize <counterparty> as …". */
export function ruleFor(tx: CategorizableTx): Pick<Rule, 'field' | 'pattern'> | null {
  if (tx.counterpartyName) return { field: 'counterparty_name', pattern: norm(tx.counterpartyName) };
  if (tx.counterpartyMaskedId) return { field: 'counterparty_masked_id', pattern: tx.counterpartyMaskedId };
  return null;
}

function matches(rule: Rule, tx: CategorizableTx): boolean {
  switch (rule.field) {
    case 'counterparty_name':
      return tx.counterpartyName !== null && norm(tx.counterpartyName) === norm(rule.pattern);
    case 'counterparty_masked_id':
      return tx.counterpartyMaskedId === rule.pattern;
    case 'kind':
      return tx.kind === rule.pattern;
    case 'text':
      return tx.counterpartyName !== null && norm(tx.counterpartyName).includes(norm(rule.pattern));
  }
}

/**
 * Picks a category key: user rules (by priority, lower first) → keyword hints → kind default → "other".
 * Returns how it decided so the UI can explain it.
 */
export function categorize(
  tx: CategorizableTx,
  rules: readonly Rule[],
): { categoryKey: string; via: 'rule' | 'keyword' | 'kind' | 'fallback' } {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const hit = sorted.find((r) => matches(r, tx));
  if (hit) return { categoryKey: hit.categoryKey, via: 'rule' };

  if (tx.counterpartyName) {
    const kw = KEYWORD_HINTS.find(([re]) => re.test(tx.counterpartyName!));
    if (kw) return { categoryKey: kw[1], via: 'keyword' };
  }

  const byKind = KIND_DEFAULTS[tx.kind as TransactionKind];
  if (byKind) return { categoryKey: byKind, via: 'kind' };
  return { categoryKey: 'other', via: 'fallback' };
}
