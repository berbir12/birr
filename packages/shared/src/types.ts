/** Where an SMS came from. Extend as new senders get templates. */
export type Source = 'telebirr' | 'cbe';

export type Direction = 'in' | 'out';

export const TRANSACTION_KINDS = [
  'transfer_out',
  'transfer_in',
  'merchant_payment',
  'airtime',
  'data_package',
  'bill_payment',
  'cash_in',
  'cash_out',
  'bank_to_wallet',
  'wallet_to_bank',
  'salary',
  'credit',
  'debit',
  'fee_only',
  'reversal',
  'unknown',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** All money values are integer cents (santim) to avoid float drift. */
export type Cents = number;

/** Output of a parser template. Account numbers are already masked. */
export interface ParsedSms {
  source: Source;
  /** Template id that matched, e.g. "telebirr.transfer_out.v1". */
  template: string;
  direction: Direction;
  kind: TransactionKind;
  amount: Cents;
  /** Service fee / charge, excluding taxes. */
  fee: Cents;
  vat: Cents;
  /** Any other levies (e.g. CBE "Disaster Recovery" 5%). */
  otherCharges: Cents;
  balanceAfter: Cents | null;
  counterpartyName: string | null;
  /** Masked, e.g. "****1234". Never a full number. */
  counterpartyMaskedId: string | null;
  /** Masked own account, e.g. "****4321", when the SMS names it. */
  accountMaskedId: string | null;
  reference: string | null;
  receiptUrl: string | null;
  /** ISO string; null means "use the SMS received time". */
  occurredAt: string | null;
  /** Non-fatal oddities (e.g. charges do not add up to the stated total). */
  warnings: string[];
  /** 1 for regex templates; LLM fallback reports its own. */
  confidence: number;
  raw: string;
}

export type ParseResult =
  | { ok: true; tx: ParsedSms }
  | { ok: false; reason: 'unknown_sender' | 'no_template' | 'not_a_transaction'; raw: string };

export type IngestChannel = 'bot' | 'webhook' | 'import' | 'manual' | 'llm';

export type Locale = 'en' | 'am';
export type CalendarMode = 'gregorian' | 'ethiopian';
