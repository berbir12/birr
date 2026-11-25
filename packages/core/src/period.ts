/**
 * Calendar periods in the user's time zone (Africa/Addis_Ababa by default), as UTC instants.
 * Ethiopian-calendar months come in Phase 7; everything that needs "this month" goes through here.
 */

/** Local wall-clock parts of an instant in `tz`. */
export function localParts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour!, minute: +p.minute!, second: +p.second! };
}

/** UTC instant of a local wall-clock time in `tz` (handles any fixed or DST offset). */
export function zonedTime(tz: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Offset at the guess; one correction step is exact except inside DST gaps (none in Ethiopia).
  const p = localParts(guess, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (asUtc - guess);
}

export interface MonthPeriod {
  /** "2026-11" */
  key: string;
  start: number;
  /** Exclusive. */
  end: number;
  daysInMonth: number;
}

export function monthOf(ms: number, tz: string): MonthPeriod {
  const { year, month } = localParts(ms, tz);
  return monthPeriod(year, month, tz);
}

export function monthPeriod(year: number, month: number, tz: string): MonthPeriod {
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    start: zonedTime(tz, year, month, 1),
    end: zonedTime(tz, nextY, nextM, 1),
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

export function previousMonth(p: MonthPeriod, tz: string): MonthPeriod {
  const [y, m] = p.key.split('-').map(Number) as [number, number];
  return m === 1 ? monthPeriod(y - 1, 12, tz) : monthPeriod(y, m - 1, tz);
}

/** Start of the local day containing `ms`. */
export function startOfDay(ms: number, tz: string): number {
  const { year, month, day } = localParts(ms, tz);
  return zonedTime(tz, year, month, day);
}

/** "2026-11-24" in local time. */
export function dayKey(ms: number, tz: string): string {
  const { year, month, day } = localParts(ms, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days left in the month including today (≥ 1). */
export function daysLeftInMonth(now: number, tz: string): number {
  const p = monthOf(now, tz);
  return p.daysInMonth - localParts(now, tz).day + 1;
}
