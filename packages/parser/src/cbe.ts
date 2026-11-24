import { AMT } from './amount.js';
import { ACCOUNT, maskId } from './mask.js';
import { amountOf, grab, grabAmount, grabAmountOrNull, re, type Extracted, type Template } from './template.js';

/** CBE SMS carry no date; occurred_at falls back to the received time. */
function common(text: string) {
  const receipt = /(https:\/\/mbreciept\.cbe\.com\.et\/(\S+))/i.exec(text);
  return {
    fee: grabAmount(text, re(`Service charge of ETB ${AMT}`)),
    vat: grabAmount(text, re(`VAT\\(\\d+%\\) of ETB ${AMT}`)),
    otherCharges: grabAmount(text, re(`Disaster Recovery\\(\\d+%\\) of (?:ETB )?${AMT}`)),
    balanceAfter: grabAmountOrNull(text, re(`Your current balance is ETB ${AMT}`)),
    receiptUrl: receipt?.[1] ?? null,
    // The receipt token is unique per transaction; FT refs are a fallback if CBE ever includes them.
    reference: receipt?.[2] ?? grab(text, /\b(FT[A-Z0-9]{8,})\b/),
    occurredAt: null,
  } satisfies Partial<Extracted>;
}

/** CBE states "with total of ETB X"; if our parts don't add up, something was misread. */
function checkTotal(text: string, e: Extracted): Extracted {
  const total = grabAmountOrNull(text, re(`with total of ETB ${AMT}`));
  if (total !== null && total !== e.amount + e.fee + e.vat + e.otherCharges) {
    return { ...e, warnings: [...(e.warnings ?? []), 'charges_total_mismatch'] };
  }
  return e;
}

export const cbeTemplates: Template[] = [
  {
    // "You have successfully transferred ETB 2,500.00 from account 1****4321 to account 1****1101 (Name)."
    id: 'cbe.transfer_out.v1',
    source: 'cbe',
    match: re(`You have successfully transferred ETB ${AMT} from account (${ACCOUNT}) to account (${ACCOUNT}) \\((.+?)\\)\\.`),
    extract: (m, text) =>
      checkTotal(text, {
        ...common(text),
        direction: 'out',
        kind: 'transfer_out',
        amount: amountOf(m[1]),
        accountMaskedId: maskId(m[2]!),
        counterpartyMaskedId: maskId(m[3]!),
        counterpartyName: m[4]!.trim(),
      }),
  },
  {
    // "You have received ETB 5,000.00 from account 1****2202 (Name) to your account 1****4321."
    id: 'cbe.transfer_in.v1',
    source: 'cbe',
    match: re(`You have received ETB ${AMT} from account (${ACCOUNT}) \\((.+?)\\) to your account (${ACCOUNT})`),
    extract: (m, text) => ({
      ...common(text),
      direction: 'in',
      kind: 'transfer_in',
      amount: amountOf(m[1]),
      counterpartyMaskedId: maskId(m[2]!),
      counterpartyName: m[3]!.trim(),
      accountMaskedId: maskId(m[4]!),
    }),
  },
  {
    // "A debit transaction of ETB 100.00 has occurred on your account 1****4321."
    // CBE uses this wording for ATM, POS, CBE->telebirr and others without saying which.
    id: 'cbe.debit.v1',
    source: 'cbe',
    match: re(`A debit transaction of ETB ${AMT} has occurred on your account (${ACCOUNT})`),
    extract: (m, text) =>
      checkTotal(text, {
        ...common(text),
        direction: 'out',
        kind: 'debit',
        amount: amountOf(m[1]),
        accountMaskedId: maskId(m[2]!),
        counterpartyName: null,
        counterpartyMaskedId: null,
      }),
  },
];
