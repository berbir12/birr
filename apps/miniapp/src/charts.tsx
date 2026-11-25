/**
 * Small SVG charts following the dataviz method: thin marks, 2px surface gaps, rounded data ends
 * anchored to the baseline, recessive axes, legend + direct labels, tap-to-inspect (mobile hover).
 * Values are always also shown as text next to the chart (colour never carries meaning alone).
 */
import { useState } from 'react';
import { money, moneyShort } from './format';
import { slotColor, type Slot } from './theme';

// ---------------------------------------------------------------- donut

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  slot: Slot;
}

export function Donut({ data, size = 176, center, selected, onSelect }: {
  data: DonutDatum[];
  size?: number;
  center: React.ReactNode;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = data.length > 1 ? 2.5 : 0; // px of surface between segments
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Spending by category">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-hint/10" />
        {total > 0 &&
          data.map((d) => {
            const len = (d.value / total) * c;
            const seg = (
              <circle
                key={d.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={slotColor(d.slot)}
                strokeWidth={selected === d.key ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                opacity={selected && selected !== d.key ? 0.35 : 1}
                className="cursor-pointer transition-all duration-200"
                onClick={() => onSelect?.(selected === d.key ? null : d.key)}
              >
                <title>{`${d.label}: ETB ${money(d.value)}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

// ---------------------------------------------------------------- grouped bars (cash flow)

export interface BarGroup {
  key: string;
  label: string;
  a: number;
  b: number;
}

/** Two series per group (money in / money out) on one axis. */
export function GroupedBars({ data, aLabel, bLabel, aSlot = 1, bSlot = 2, height = 168 }: {
  data: BarGroup[];
  aLabel: string;
  bLabel: string;
  aSlot?: Slot;
  bSlot?: Slot;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(data.at(-1)?.key ?? null);
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const plotH = height - 22;
  const sel = data.find((d) => d.key === active);
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[13px] text-hint">
        <Legend slot={aSlot} label={aLabel} />
        <Legend slot={bSlot} label={bLabel} />
        {sel && (
          <span className="ml-auto text-right text-text">
            <span className="font-semibold">{sel.label}</span>{' '}
            <span className="tabular">
              +{moneyShort(sel.a)} / −{moneyShort(sel.b)}
            </span>
          </span>
        )}
      </div>
      <div className="relative flex items-end gap-2" style={{ height }}>
        <div className="pointer-events-none absolute inset-x-0 border-t border-sep" style={{ bottom: 22 }} />
        {data.map((d) => (
          <button
            key={d.key}
            onClick={() => setActive(d.key)}
            className="flex h-full flex-1 flex-col items-center justify-end"
            aria-label={`${d.label}: in ETB ${money(d.a)}, out ETB ${money(d.b)}`}
          >
            <div className="flex w-full items-end justify-center gap-[2px]" style={{ height: plotH }}>
              {[
                [d.a, aSlot],
                [d.b, bSlot],
              ].map(([v, s], i) => (
                <div
                  key={i}
                  className="w-full max-w-[14px] rounded-t-[4px] transition-all duration-300"
                  style={{
                    height: `${Math.max((v as number) > 0 ? 2 : 0, ((v as number) / max) * 100)}%`,
                    background: slotColor(s as Slot),
                    opacity: active && active !== d.key ? 0.4 : 1,
                  }}
                />
              ))}
            </div>
            <span className={`mt-1.5 text-[11px] ${active === d.key ? 'font-semibold text-text' : 'text-hint'}`}>{d.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Legend({ slot, label }: { slot: Slot; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: slotColor(slot) }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- calendar heatmap

/**
 * Month calendar, Monday first; each day shaded on a one-hue scale by spending.
 * `days` maps "YYYY-MM-DD" → cents.
 */
export function Heatmap({ year, month, days, today, onPick }: {
  year: number;
  month: number;
  days: Record<string, number>;
  today: string;
  onPick?: (day: string, value: number) => void;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const values = Object.values(days).filter((v) => v > 0).sort((a, b) => a - b);
  // Quantile steps so one huge day doesn't wash everything else out.
  const step = (v: number) => {
    if (v <= 0) return 0;
    const rank = values.findIndex((x) => x >= v) / Math.max(1, values.length - 1);
    return 1 + Math.min(5, Math.floor(rank * 6));
  };
  const cells: Array<{ day: number; key: string } | null> = [...Array(lead).fill(null)];
  for (let d = 1; d <= count; d++) cells.push({ day: d, key: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-hint">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) =>
          c ? (
            <button
              key={c.key}
              onClick={() => onPick?.(c.key, days[c.key] ?? 0)}
              disabled={c.key > today}
              className={`flex aspect-square items-center justify-center rounded-[8px] text-[12px] tabular disabled:opacity-30 ${c.key === today ? 'ring-2 ring-accent' : ''}`}
              style={{
                background: `var(--birr-heat-${step(days[c.key] ?? 0)})`,
                color: step(days[c.key] ?? 0) >= 4 ? '#fff' : 'var(--color-text)',
              }}
              aria-label={`${c.key}: ETB ${money(days[c.key] ?? 0)}`}
            >
              {c.day}
            </button>
          ) : (
            <span key={`x${i}`} />
          ),
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-hint">
        less
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <span key={s} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: `var(--birr-heat-${s})` }} />
        ))}
        more
      </div>
    </div>
  );
}
