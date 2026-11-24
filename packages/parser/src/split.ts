/**
 * Splits a paste that may contain several SMS into individual messages.
 * Every telebirr/CBE transaction SMS seen so far starts with "Dear ", so that is the boundary.
 * Text without any "Dear" is returned as one message.
 */
export function splitMessages(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\s*(?=\bDear\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
