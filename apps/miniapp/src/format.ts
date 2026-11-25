/**
 * Display formatting. All dates go through here so the Ethiopian calendar (Phase 7) is one switch.
 */
import { KIND_LABELS, type TransactionKind } from '@birr/shared';
import { t } from './i18n';

export const TZ = 'Africa/Addis_Ababa';

const NUM = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 550000 → "5,500.00" */
export const money = (cents: number) => NUM.format(Math.abs(cents) / 100);
/** 550000 → "5,500" (for big headline numbers) */
export const moneyShort = (cents: number) => NUM0.format(Math.round(Math.abs(cents) / 100));
export const etb = (cents: number) => `ETB ${money(cents)}`;

/** Parses user input like "1,250.50" into cents; null if invalid. */
export function parseEtb(s: string): number | null {
  const v = s.replace(/[,\s]/g, '').replace(/^ETB/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [w = '0', f = ''] = v.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
const TIME = dateFmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = dateFmt({ weekday: 'short', day: 'numeric', month: 'short' });
const DAY_YEAR = dateFmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const FULL = dateFmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const MONTH = dateFmt({ month: 'long', year: 'numeric' });

export const time = (ms: number) => TIME.format(ms);
export const fullDate = (ms: number) => FULL.format(ms);
export const monthName = (ms: number) => MONTH.format(ms);

/** "2026-11-24" in Addis time, for grouping by day. */
export const dayKey = (ms: number) => dateFmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).split('/').reverse().join('-');

export function dayLabel(ms: number, now = Date.now()): string {
  const k = dayKey(ms);
  if (k === dayKey(now)) return t('tx.today');
  if (k === dayKey(now - 86400_000)) return t('tx.yesterday');
  return (dayKey(ms).slice(0, 4) === dayKey(now).slice(0, 4) ? DAY : DAY_YEAR).format(ms);
}

export const kindLabel = (k: string) => KIND_LABELS[k as TransactionKind] ?? k;

/** "Selam Bekele" or a readable fallback from the kind. */
export const title = (x: { counterparty: string | null; kind: string }) => x.counterparty ?? kindLabel(x.kind);

/** "YYYY-MM-DDTHH:mm" for <input type=datetime-local>, in Addis time. */
export function toLocalInput(ms: number): string {
  const p = Object.fromEntries(
    dateFmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const fromLocalInput = (s: string) => Date.parse(`${s}:00+03:00`);
