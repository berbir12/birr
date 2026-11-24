import { AMT } from './amount.js';
import { DATETIME, parseSmsDate } from './date.js';
import { ACCOUNT, maskId } from './mask.js';
import { amountOf, grab, grabAmount, grabAmountOrNull, re, type Extracted, type Template } from './template.js';

/** Fields telebirr puts in most messages regardless of transaction type. */
function common(text: string) {
  return {
    reference: grab(text, /transaction number is ([A-Z0-9]+)/i),
    fee: grabAmount(text, re(`service fee is ETB ${AMT}`)),
    vat: grabAmount(text, re(`VAT on the service fee is ETB ${AMT}`)),
    otherCharges: 0,
    balanceAfter: grabAmountOrNull(text, re(`current (?:E-Money Account )?balance is ETB ${AMT}`)),
    receiptUrl: grab(text, /(https:\/\/transactioninfo\.ethiotelecom\.et\/receipt\/[A-Za-z0-9]+)/i),
  } satisfies Partial<Extracted>;
}

export const telebirrTemplates: Template[] = [
  {
    // "You have transferred ETB 5,500.00 to Selam Bekele (2519****1234) on 24/11/2026 20:31:20."
    id: 'telebirr.transfer_out.v1',
    source: 'telebirr',
    match: re(`You have transferred ETB ${AMT} to (.+?) \\((${ACCOUNT})\\) on (${DATETIME})`),
    extract: (m, text) => ({
      ...common(text),
      direction: 'out',
      kind: 'transfer_out',
      amount: amountOf(m[1]),
      counterpartyName: m[2]!.trim(),
      counterpartyMaskedId: maskId(m[3]!),
      accountMaskedId: null,
      occurredAt: parseSmsDate(m[4]!),
    }),
  },
  {
    // "You have transferred ETB 4,500.00 successfully from your telebirr account 2519... to
    //  Awash International Bank S C account number 0132... on 24/11/2026 20:22:40."
    id: 'telebirr.wallet_to_bank.v1',
    source: 'telebirr',
    match: re(
      `You have transferred ETB ${AMT} successfully from your telebirr account (\\d+) to (.+?) account number (\\d+) on (${DATETIME})`,
    ),
    extract: (m, text) => ({
      ...common(text),
      direction: 'out',
      kind: 'wallet_to_bank',
      amount: amountOf(m[1]),
      accountMaskedId: maskId(m[2]!),
      counterpartyName: m[3]!.trim(),
      counterpartyMaskedId: maskId(m[4]!),
      occurredAt: parseSmsDate(m[5]!),
    }),
  },
  {
    // "Your telebirr account 2519... has been credited with ETB 9,706.00 on ... via telebirr agent 12345."
    id: 'telebirr.cash_in_agent.v1',
    source: 'telebirr',
    match: re(`Your telebirr account (\\d+) has been credited with ETB ${AMT} on (${DATETIME}) via telebirr agent (\\w+)`),
    extract: (m, text) => ({
      ...common(text),
      direction: 'in',
      kind: 'cash_in',
      amount: amountOf(m[2]),
      accountMaskedId: maskId(m[1]!),
      counterpartyName: `telebirr agent ${m[4]}`,
      counterpartyMaskedId: null,
      occurredAt: parseSmsDate(m[3]!),
    }),
  },
];
