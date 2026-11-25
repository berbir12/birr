import type { AnalyticsRange } from '@birr/shared';
import { ChartPie, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Donut, GroupedBars, Heatmap, type DonutDatum } from '../charts';
import { useAnalytics, useCategories } from '../data';
import { dayKey, etb, money, moneyShort, TZ } from '../format';
import { t } from '../i18n';
import { CategoryIcon, chartSlots, slotColor } from '../theme';
import { Empty, ErrorState, Money, PageHeader, Row, Section, Segmented, Spinner } from '../ui';

const MONTH_SHORT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
const DAY_LONG = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

export function Insights() {
  const [range, setRange] = useState<AnalyticsRange>('month');
  const a = useAnalytics(range);
  const cats = useCategories();
  const [, go] = useLocation();
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<{ day: string; value: number } | null>(null);

  const donut = useMemo(() => {
    const rows = a.data?.byCategory ?? [];
    const top = rows.slice(0, 5);
    const rest = rows.slice(5).reduce((s, r) => s + r.amount, 0);
    const slots = chartSlots(top.map((r) => r.categoryKey));
    const data: DonutDatum[] = top.map((r) => ({ key: r.categoryKey, label: r.name, value: r.amount, slot: slots.get(r.categoryKey) ?? 0 }));
    if (rest > 0) data.push({ key: '__other', label: 'Everything else', value: rest, slot: 0 });
    return data;
  }, [a.data]);

  const catId = (key: string) => cats.data?.find((c) => c.key === key)?.id;
  const nowKey = dayKey(Date.now());
  const [y, m] = nowKey.split('-').map(Number) as [number, number];
  const heatMonth = range === 'last-month' ? (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }) : { y, m };
  const noSpendDays = useMemo(() => {
    if (!a.data || (range !== 'month' && range !== 'last-month')) return null;
    const last = range === 'month' ? Number(nowKey.slice(8)) : new Date(Date.UTC(heatMonth.y, heatMonth.m, 0)).getUTCDate();
    let n = 0;
    for (let d = 1; d <= last; d++) {
      const k = `${heatMonth.y}-${String(heatMonth.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!a.data.daily[k]) n++;
    }
    return n;
  }, [a.data, range, nowKey, heatMonth.y, heatMonth.m]);

  return (
    <div className="px-4 pt-4">
      <PageHeader title={t('insights.title')} />
      <div className="mb-5">
        <Segmented
          value={range}
          onChange={(v) => (setRange(v), setSelected(null), setPickedDay(null))}
          options={[
            { value: 'month', label: t('insights.month') },
            { value: 'last-month', label: t('insights.lastMonth') },
            { value: '3m', label: t('insights.3m') },
            { value: 'year', label: t('insights.year') },
          ]}
        />
      </div>

      {a.isLoading && <Spinner />}
      {a.error && <ErrorState error={a.error} onRetry={() => void a.refetch()} />}
      {a.data && (
        <>
          {/* Where it went */}
          <Section title={t('insights.byCategory')}>
            {a.data.byCategory.length === 0 ? (
              <Empty title={t('insights.empty')} icon={ChartPie} />
            ) : (
              <>
                <div className="flex justify-center px-4 pb-2 pt-5">
                  <Donut
                    data={donut}
                    selected={selected}
                    onSelect={setSelected}
                    center={
                      selected ? (
                        <>
                          <span className="max-w-[110px] truncate text-[12px] text-hint">{donut.find((d) => d.key === selected)?.label}</span>
                          <span className="tabular text-[20px] font-bold">{moneyShort(donut.find((d) => d.key === selected)?.value ?? 0)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-[12px] text-hint">{t('insights.spent')}</span>
                          <span className="tabular text-[22px] font-bold">{moneyShort(a.data.totalOut)}</span>
                        </>
                      )
                    }
                  />
                </div>
                {a.data.byCategory.slice(0, 8).map((c) => {
                  const slot = donut.find((d) => d.key === c.categoryKey)?.slot ?? 0;
                  const pct = a.data.totalOut ? Math.round((c.amount / a.data.totalOut) * 100) : 0;
                  return (
                    <Row
                      key={c.categoryKey}
                      left={<CategoryIcon categoryKey={c.categoryKey} emoji={c.icon} size={34} />}
                      onClick={() => {
                        const id = catId(c.categoryKey);
                        if (id) go(`/transactions?categoryId=${id}`);
                      }}
                      chevron
                      right={
                        <span className="text-right">
                          <span className="tabular block text-[15px] font-semibold">{money(c.amount)}</span>
                          <span className="tabular block text-[12px] text-hint">{pct}%</span>
                        </span>
                      }
                    >
                      <span className="flex items-center gap-2 text-[15px]">
                        {donut.some((d) => d.key === c.categoryKey) && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slotColor(slot) }} />}
                        {c.name}
                      </span>
                    </Row>
                  );
                })}
              </>
            )}
          </Section>

          {/* Cash flow */}
          <Section title={t('insights.cashflow')}>
            <div className="p-4">
              <GroupedBars
                aLabel={t('insights.cashIn')}
                bLabel={t('insights.cashOut')}
                aSlot={3}
                bSlot={2}
                data={a.data.cashflow.map((c) => ({ key: c.key, label: MONTH_SHORT.format(c.start), a: c.in, b: c.out }))}
              />
            </div>
          </Section>

          {/* Daily heatmap */}
          {(range === 'month' || range === 'last-month') && (
            <Section title={t('insights.daily')} footer={noSpendDays !== null ? t('insights.noSpend', { n: noSpendDays }) : undefined}>
              <div className="p-4">
                <Heatmap year={heatMonth.y} month={heatMonth.m} days={a.data.daily} today={nowKey} onPick={(day, value) => setPickedDay({ day, value })} />
                {pickedDay && (
                  <p className="mt-3 text-center text-[14px]">
                    {t('insights.dayTotal', { day: DAY_LONG.format(Date.parse(`${pickedDay.day}T12:00:00+03:00`)), amount: etb(pickedDay.value) })}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Top people */}
          {a.data.topPeople.length > 0 && (
            <Section title={t('insights.people')}>
              {a.data.topPeople.slice(0, 6).map((p) => (
                <Row
                  key={p.key}
                  left={<Avatar name={p.name} />}
                  onClick={p.personId ? () => go(`/people/${p.personId}`) : undefined}
                  chevron={Boolean(p.personId)}
                  right={
                    <span className="text-right text-[13px]">
                      {p.out > 0 && <span className="tabular block font-semibold">−{moneyShort(p.out)}</span>}
                      {p.in > 0 && <span className="tabular block font-semibold text-in">+{moneyShort(p.in)}</span>}
                    </span>
                  }
                >
                  <span className="block truncate text-[15px]">{p.name}</span>
                  <span className="text-[12px] text-hint">{p.count}×</span>
                </Row>
              ))}
            </Section>
          )}

          {/* Fees & VAT */}
          <Section title={t('insights.fees')}>
            <div className="flex items-start gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hint/15 text-hint">
                <Receipt size={20} />
              </div>
              <div className="min-w-0">
                <Money cents={a.data.fees.total} size={24} />
                <p className="mt-1 text-[13px] text-hint">
                  {t('insights.feesRange', { fee: etb(a.data.fees.fee), vat: etb(a.data.fees.vat), other: etb(a.data.fees.other) })} ·{' '}
                  {t('insights.feesCount', { n: a.data.fees.count })}
                </p>
                <p className="mt-2 text-[14px] leading-snug">{t('insights.feesYear', { amount: etb(a.data.fees.yearTotal) })}</p>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  // Stable hue per name so the same person always gets the same colour.
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const slot = ((h % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  const color = slotColor(slot);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      {initials || '?'}
    </div>
  );
}
