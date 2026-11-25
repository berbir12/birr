import { useLocation } from 'wouter';
import { useRecategorize } from '../components/Recategorize';
import { TxRow } from '../components/TxRow';
import { useDeleteTx, useRestoreTx, useSummary } from '../data';
import { etb, monthName, money, moneyShort } from '../format';
import { t } from '../i18n';
import { Empty, ErrorState, Section, Spinner, useToast } from '../ui';

const ACCOUNT_ICON: Record<string, string> = { telebirr: '📱', cbe: '🏦', cash: '💵', other: '💳' };

export function Home() {
  const s = useSummary();
  const [, go] = useLocation();
  const recat = useRecategorize();
  const del = useDeleteTx();
  const restore = useRestoreTx();
  const toast = useToast();

  if (s.isLoading) return <Spinner />;
  if (s.error || !s.data) return <ErrorState error={s.error} onRetry={() => void s.refetch()} />;
  const d = s.data;
  const empty = d.recent.length === 0;

  return (
    <div className="px-3 pt-4">
      {/* Balance */}
      <div className="mb-4 px-2">
        <p className="text-sm text-hint">{t('home.total')}</p>
        <p className="tabular text-[34px] font-semibold leading-tight tracking-tight">
          <span className="mr-1.5 align-middle text-lg font-normal text-hint">ETB</span>
          {money(d.total)}
        </p>
      </div>
      <div className="-mx-3 mb-5 flex gap-2 overflow-x-auto px-3 pb-1">
        {d.accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => go(`/transactions?accountId=${a.id}`)}
            className="shrink-0 rounded-2xl bg-section px-3.5 py-2.5 text-left active:opacity-70"
          >
            <div className="text-[12px] text-hint">
              {ACCOUNT_ICON[a.type]} {a.name}
            </div>
            <div className="tabular font-medium">{moneyShort(a.balance)}</div>
          </button>
        ))}
      </div>

      {empty ? (
        <Section>
          <Empty title={t('home.empty.title')} body={t('home.empty.body')} icon="📩" />
        </Section>
      ) : (
        <>
          {/* This month */}
          <Section title={`${t('home.thisMonth')} · ${monthName(d.month.start)}`}>
            <div className="grid grid-cols-2 divide-x divide-sep">
              <div className="px-4 py-3">
                <p className="text-[13px] text-hint">{t('home.in')}</p>
                <p className="tabular text-xl font-semibold text-in">+{moneyShort(d.monthIn)}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[13px] text-hint">{t('home.out')}</p>
                <p className="tabular text-xl font-semibold">−{moneyShort(d.monthOut)}</p>
                {d.monthFees > 0 && <p className="text-[12px] text-hint">{t('home.fees', { fees: etb(d.monthFees) })}</p>}
              </div>
            </div>
            <div className="border-t border-sep px-4 py-3">
              <p className="text-[13px] text-hint">{t('home.safeToSpend')}</p>
              {d.safeToSpendToday !== null ? (
                <p className="tabular text-xl font-semibold">{etb(d.safeToSpendToday)}</p>
              ) : (
                <p className="text-sm text-hint">{t('home.safeToSpend.none')}</p>
              )}
            </div>
            {d.insight && (
              <div className="border-t border-sep px-4 py-3 text-[15px]">
                {d.insight.pct > 0 ? '📈 ' : '📉 '}
                {t(d.insight.pct > 0 ? 'home.insight.up' : 'home.insight.down', {
                  pct: Math.abs(d.insight.pct),
                  category: d.insight.categoryName.toLowerCase(),
                })}
              </div>
            )}
          </Section>

          {(d.reviewCount > 0 || d.gapCount > 0) && (
            <Section>
              {d.reviewCount > 0 && (
                <button onClick={() => go('/review')} className="flex w-full items-center gap-3 border-b border-sep px-4 py-3 text-left last:border-b-0">
                  <span>🔍</span>
                  <span className="flex-1">{t('home.reviewWaiting', { n: d.reviewCount })}</span>
                  <span className="text-hint">›</span>
                </button>
              )}
              {d.gapCount > 0 && (
                <button onClick={() => go('/transactions?gaps=1')} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span>⚠️</span>
                  <span className="flex-1">{t('home.gaps', { n: d.gapCount })}</span>
                  <span className="text-hint">›</span>
                </button>
              )}
            </Section>
          )}

          <Section
            title={t('home.recent')}
            action={
              <button onClick={() => go('/transactions')} className="text-[15px] text-link">
                {t('home.seeAll')}
              </button>
            }
          >
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
