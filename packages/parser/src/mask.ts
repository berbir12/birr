/** Keep only the last 4 digits of any account/phone id: "251900001111" -> "****1111". */
export function maskId(id: string): string {
  const digits = id.replace(/\D/g, '');
  return `****${digits.slice(-4)}`;
}

/**
 * Masks any run of 7+ digits (phone/account numbers) and pre-masked ids in free text,
 * leaving amounts ("1,234.56") and dates alone. Used before showing or sending text anywhere.
 */
export function scrubNumbers(text: string): string {
  return text
    .replace(/(?<![\d.,])\d{7,}(?!\d|[.,]\d)/g, (m) => maskId(m))
    .replace(/\b\d+\*{3,}\d+\b/g, (m) => maskId(m));
}

/** Regex fragment for an account id as printed in SMS, possibly pre-masked: 1********4321. */
export const ACCOUNT = String.raw`\d[\d*]*\d`;
