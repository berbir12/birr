import type { Cents, TransactionKind } from './types.js';

const NUM = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 550000 -> "ETB 5,500.00" */
export function formatEtb(cents: Cents, opts: { sign?: boolean } = {}): string {
  const abs = NUM.format(Math.abs(cents) / 100);
  const sign = cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : '';
  return `${sign}ETB ${abs}`;
}

export const KIND_LABELS: Record<TransactionKind, string> = {
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  merchant_payment: 'Merchant payment',
  airtime: 'Airtime',
  data_package: 'Data package',
  bill_payment: 'Bill payment',
  cash_in: 'Cash in',
  cash_out: 'Cash out',
  bank_to_wallet: 'Bank → wallet',
  wallet_to_bank: 'Wallet → bank',
  salary: 'Salary',
  credit: 'Credit',
  debit: 'Debit',
  fee_only: 'Fee',
  reversal: 'Reversal',
  unknown: 'Unknown',
};

/** "DAWIT ALEMU" -> "Dawit Alemu"; leaves mixed-case names ("Tesfaye W/mariam") alone. */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name.trim();
  return name
    .toLowerCase()
    .replace(/(^|[\s/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}
