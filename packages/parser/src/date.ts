const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const RE =
  /^(\d{1,2})[/\-\s]([A-Za-z]{3}|\d{1,2})[/\-\s](\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Parses dates as they appear in Ethiopian bank/wallet SMS (always local time, EAT = UTC+3,
 * no DST) and returns an ISO-8601 string with offset, or null if invalid.
 * Supports dd/mm/yyyy, dd-mm-yyyy, dd-MMM-yyyy, dd MMM yyyy, with optional 12h/24h time.
 */
export function parseSmsDate(input: string): string | null {
  const m = RE.exec(input.trim());
  if (!m) return null;
  const [, d, mon = '', y, hh, mm, ss, ampm] = m;
  const day = Number(d);
  const month = /^\d+$/.test(mon) ? Number(mon) : MONTHS.indexOf(mon.toLowerCase()) + 1;
  const year = Number(y);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;

  let hour = hh === undefined ? 0 : Number(hh);
  const minute = mm === undefined ? 0 : Number(mm);
  const second = ss === undefined ? 0 : Number(ss);
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
}

/** Regex fragment matching the date+time formats seen in SMS so far. */
export const DATETIME = String.raw`\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}(?::\d{2})?(?: ?[AaPp][Mm])?`;
