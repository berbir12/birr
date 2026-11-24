import type { Cents } from '@birr/shared';

const CURRENCY = /\b(?:ETB|Birr|Br)\b\.?|(?<=\d)\s*(?:ETB|Birr|Br)\b|^(?:ETB|Br)(?=\d)/gi;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const PLAIN = /^\d+(?:\.\d{1,2})?$/;

/** "ETB 1,234.56" | "Birr 250" | "Br.1,000" | "1234" -> integer cents, or null. */
export function parseAmount(input: string): Cents | null {
  const s = input.replace(CURRENCY, '').replace(/\s+/g, '').replace(/^\./, '');
  if (!GROUPED.test(s) && !PLAIN.test(s)) return null;
  const [whole = '', frac = ''] = s.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Regex fragment for an amount inside a sentence. Stops before a trailing full stop. */
export const AMT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
