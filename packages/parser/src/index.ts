import type { ParseResult, Source } from '@birr/shared';
import { cbeTemplates } from './cbe.js';
import { telebirrTemplates } from './telebirr.js';
import type { Template } from './template.js';

export { AMT, parseAmount } from './amount.js';
export { parseSmsDate } from './date.js';
export { maskId, scrubNumbers } from './mask.js';
export { splitMessages } from './split.js';
export type { Template } from './template.js';

export const TEMPLATES: Record<Source, Template[]> = {
  telebirr: telebirrTemplates,
  cbe: cbeTemplates,
};

/** Confidence assigned when a template matched but its own sanity checks failed. */
const WARNING_CONFIDENCE = 0.5;

/**
 * Identify the source from the SMS sender id, or from the body when pasted without one.
 * A sender that is present but unrecognised is rejected, never guessed.
 */
export function detectSource(sender: string | null | undefined, body: string): Source | null {
  const s = sender?.trim();
  if (s) {
    if (/^\+?127$/.test(s) || /^telebirr$/i.test(s)) return 'telebirr';
    if (/^CBE$/i.test(s)) return 'cbe';
    return null;
  }
  if (/telebirr|Ethio ?telecom/i.test(body)) return 'telebirr';
  if (/\bCBE\b|mbreciept\.cbe\.com\.et/i.test(body)) return 'cbe';
  return null;
}

export function parseSms(input: { body: string; sender?: string | null }): ParseResult {
  const raw = input.body;
  const source = detectSource(input.sender, raw);
  if (!source) return { ok: false, reason: 'unknown_sender', raw };

  const text = raw.replace(/\s+/g, ' ').trim();
  for (const t of TEMPLATES[source]) {
    const m = t.match.exec(text);
    if (!m) continue;
    let extracted;
    try {
      extracted = t.extract(m, text);
    } catch {
      continue; // a template that matched but could not extract must not block the next one
    }
    const { warnings = [], ...fields } = extracted;
    return {
      ok: true,
      tx: {
        source,
        template: t.id,
        ...fields,
        warnings,
        confidence: warnings.length ? WARNING_CONFIDENCE : 1,
        raw,
      },
    };
  }
  return { ok: false, reason: 'no_template', raw };
}
