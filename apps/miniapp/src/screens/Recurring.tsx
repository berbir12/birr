import { Check, Repeat, X } from 'lucide-react';
import { planApi, planKeys, usePlanMutation, useRecurring } from '../data';
import { etb, fullDate } from '../format';
import { t } from '../i18n';
import { CategoryIcon } from '../theme';
import { Empty, ErrorState, Money, Section, Spinner } from '../ui';
import { SubPage } from './Settings';

const intervalLabel = (d: number) =>
  d === 7 ? t('plan.recurring.weekly') : d === 14 ? t('plan.recurring.biweekly') : d === 30 ? t('plan.recurring.monthlyLabel') : t('plan.recurring.every', { n: d });

export function RecurringPage() {
  const r = useRecurring();
  const act = usePlanMutation(planApi.recurring, [planKeys.recurring]);
  return (
    <SubPage title={t('plan.recurring')}>
      {r.isLoading && <Spinner />}
      {r.error && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {r.data && r.data.items.length === 0 && (
        <Section>
          <Empty title={t('plan.recurring')} body={t('plan.recurring.empty')} icon={Repeat} />
        </Section>
      )}
      {r.data && r.data.items.length > 0 && (
        <>
          <div className="card mb-6 p-4">
            <p className="text-[13px] font-medium text-hint">{t('plan.recurring.total')}</p>
            <Money cents={r.data.monthlyTotal} size={30} />
          </div>
          <Section>
            {r.data.items.map((i) => (
              <div key={i.id} className="border-b border-sep px-4 py-3.5 last:border-b-0">
                <div className="flex items-center gap-3">
                  <CategoryIcon categoryKey={i.categoryKey} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold">{i.label}</p>
                    <p className="text-[12px] text-hint">
                      {intervalLabel(i.intervalDays)} · {t('plan.recurring.next', { date: fullDate(i.nextExpectedAt).replace(/,.*$/, '') })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-[15px] font-semibold">{etb(i.avgAmount)}</p>
                    {i.intervalDays !== 30 && <p className="tabular text-[12px] text-hint">{t('plan.recurring.monthly', { amount: etb(i.monthlyAmount) })}</p>}
                  </div>
                </div>
                {i.status === 'detected' && (
                  <div className="mt-2.5 flex gap-4 pl-[48px] text-[14px] font-medium">
                    <button className="flex items-center gap-1 text-link" onClick={() => act.mutate({ id: i.id, action: 'confirm' })}>
                      <Check size={15} /> {t('plan.recurring.confirm')}
                    </button>
                    <button className="flex items-center gap-1 text-hint" onClick={() => act.mutate({ id: i.id, action: 'dismiss' })}>
                      <X size={15} /> {t('plan.recurring.dismiss')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Section>
        </>
      )}
    </SubPage>
  );
}
