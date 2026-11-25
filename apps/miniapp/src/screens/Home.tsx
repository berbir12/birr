import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Banknote, Inbox, Landmark, ScanSearch, Smartphone, TrendingDown, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { useLocation } from 'wouter';
import { api } from '../api';
import { useRecategorize } from '../components/Recategorize';
import { TxRow } from '../components/TxRow';
import { useBudgets, useDeleteTx, useRestoreTx, useSummary } from '../data';
import { etb, monthName, moneyShort } from '../format';
import { t } from '../i18n';
import { Empty, ErrorState, Money, ProgressBar, Section, SectionLink, Skeleton, useToast } from '../ui';

const ACCOUNT_ICON = { telebirr: Smartphone, cbe: Landmark, cash: Banknote, other: Wallet } as const;

export function Home() {
  const s = useSummary();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ firstName: string | null }>('/me'), staleTime: Infinity });
  const budgets = useBudgets();
  const [, go] = useLocation();
  const recat = useRecategorize();
  const del = useDeleteTx();
  const restore = useRestoreTx();
  const toast = useToast();

  if (s.isLoading)
    return (
      <div className="space-y-4 px-4 pt-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-44 rounded-[22px]" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  if (s.error || !s.data) return <ErrorState error={s.error} onRetry={() => void s.refetch()} />;
  const d = s.data;
  const empty = d.recent.length === 0;
  const b = budgets.data?.total;

  return (
    <div className="px-4 pt-4">
      <p className="mb-3 px-1 text-[15px] text-hint">
        {t('home.greeting')}
        {me.data?.firstName ? `, ${me.data.firstName}` : ''} 👋
      </p>

      {/* Hero */}
      <div
        className="animate-rise relative mb-4 overflow-hidden rounded-[22px] p-5 text-accent-text"
        style={{ background: 'linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 62%, #000))' }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 right-10 h-32 w-32 rounded-full bg-white/5" />
        <p className="text-[13px] font-medium opacity-80">{t('home.total')}</p>
        <Money cents={d.total} size={38} className="mt-1" />
        <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5">
          {d.accounts.map((a) => {
            const Icon = ACCOUNT_ICON[a.type];
            return (
              <button
                key={a.id}
                onClick={() => go(`/transactions?accountId=${a.id}`)}
                className="flex shrink-0 items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-left backdrop-blur active:bg-white/25"
              >
                <Icon size={16} className="opacity-90" />
                <span>
                  <span className="block text-[11px] leading-tight opacity-75">{a.name}</span>
                  <span className="tabular block text-[14px] font-semibold leading-tight">{moneyShort(a.balance)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {empty ? (
        <Section>
          <Empty title={t('home.empty.title')} body={t('home.empty.body')} icon={Inbox} />
        </Section>
      ) : (
        <>
          {/* Month */}
          <p className="mb-2 px-1 text-[13px] font-medium text-hint">
            {t('home.thisMonth')} · {monthName(d.month.start)}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Stat icon={ArrowUpRight} label={t('home.spent')} value={d.monthOut} sub={d.monthFees > 0 ? t('home.fees', { fees: etb(d.monthFees) }) : undefined} />
            <Stat icon={ArrowDownLeft} label={t('home.received')} value={d.monthIn} positive />
          </div>

          <div className="card mb-3 p-4">
            <p className="text-[13px] font-medium text-hint">{t('home.safeToSpend')}</p>
            {d.safeToSpendToday !== null ? (
              <>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <Money cents={d.safeToSpendToday} size={26} />
                  <span className="text-[13px] text-hint">{t('home.leftToday')}</span>
                </div>
                {b && b.amount > 0 && (
                  <div className="mt-3">
                    <ProgressBar pct={(b.spent / b.amount) * 100} color={b.spent > b.amount ? 'var(--birr-over)' : 'var(--color-accent)'} />
                    <p className="mt-1.5 text-[12px] text-hint">{t('home.ofBudget', { spent: etb(b.spent), total: etb(b.amount) })}</p>
                  </div>
                )}
              </>
            ) : (
              <button onClick={() => go('/plan')} className="mt-1 text-left text-[14px] text-link">
                {t('home.safeToSpend.none')}
              </button>
            )}
          </div>

          {d.insight && (
            <div className="card mb-3 flex items-start gap-3 p-4">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
              >
                {d.insight.pct > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              </div>
              <p className="text-[15px] leading-snug">
                {t(d.insight.pct > 0 ? 'home.insight.up' : 'home.insight.down', {
                  pct: Math.abs(d.insight.pct),
                  category: d.insight.categoryName.toLowerCase(),
                })}
              </p>
            </div>
          )}

          {(d.reviewCount > 0 || d.gapCount > 0) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {d.reviewCount > 0 && (
                <button onClick={() => go('/review')} className="card flex items-center gap-2 px-3.5 py-2 text-[14px] font-medium active:opacity-70">
                  <ScanSearch size={16} className="text-accent" />
                  {t('home.reviewWaiting', { n: d.reviewCount })}
                </button>
              )}
              {d.gapCount > 0 && (
                <button onClick={() => go('/transactions?gaps=1')} className="card flex items-center gap-2 px-3.5 py-2 text-[14px] font-medium active:opacity-70">
                  <TriangleAlert size={16} className="text-warn" />
                  {t('home.gaps', { n: d.gapCount })}
                </button>
              )}
            </div>
          )}

          <Section title={t('home.recent')} action={<SectionLink onClick={() => go('/transactions')}>{t('home.seeAll')}</SectionLink>} className="mt-5">
            {d.recent.map((tx) => (
              <TxRow
                key={tx.id}
                tx={tx}
                onOpen={() => go(`/tx/${tx.id}`)}
                onCategory={() => recat.open(tx.id, tx.categoryId)}
                onDelete={() =>
                  del.mutate(tx.id, {
                    onSuccess: () => toast(t('tx.deleted'), { label: t('tx.undo'), run: () => restore.mutate(tx.id) }),
                  })
                }
              />
            ))}
          </Section>
        </>
      )}
      {recat.element}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, positive }: { icon: typeof ArrowUpRight; label: string; value: number; sub?: string; positive?: boolean }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-hint">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: positive ? 'color-mix(in srgb, var(--birr-in) 14%, transparent)' : 'rgba(127,127,127,0.14)', color: positive ? 'var(--birr-in)' : 'var(--color-text)' }}
        >
          <Icon size={14} strokeWidth={2.5} />
        </span>
        {label}
      </div>
      <p className={`tabular text-[22px] font-bold tracking-tight ${positive ? 'text-in' : ''}`}>{moneyShort(value)}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-hint">{sub}</p>}
    </div>
  );
}
