import type { ParsedSms, Source } from '@birr/shared';
import { parseAmount } from './amount.js';

/** Fields a template fills in; the registry adds source/template/raw/warnings/confidence. */
export type Extracted = Omit<ParsedSms, 'source' | 'template' | 'raw' | 'warnings' | 'confidence'> & {
  warnings?: string[];
};

export interface Template {
  /** Stable id, versioned so we can tell which regex produced a stored row. */
  id: string;
  source: Source;
  /** Tested against the whitespace-normalised body. */
  match: RegExp;
  extract(m: RegExpExecArray, text: string): Extracted;
}

/** Case-insensitive regex from a string (so fragments like AMT can be interpolated). */
export const re = (s: string) => new RegExp(s, 'i');

/** First capture group of `pattern` in `text`, or null. */
export function grab(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1] ?? null;
}

/** Amount captured by `pattern`, in cents; 0 when absent. */
export function grabAmount(text: string, pattern: RegExp): number {
  return grabAmountOrNull(text, pattern) ?? 0;
}

export function grabAmountOrNull(text: string, pattern: RegExp): number | null {
  const s = grab(text, pattern);
  return s === null ? null : parseAmount(s);
}

/** Parses a captured amount that the template requires; throws so the registry skips the template. */
export function amountOf(s: string | undefined): number {
  const v = s === undefined ? null : parseAmount(s);
  if (v === null) throw new Error('unparseable amount');
  return v;
}
