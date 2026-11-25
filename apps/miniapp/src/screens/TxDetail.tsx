import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../api';
import { useRecategorize } from '../components/Recategorize';
import { useDeleteTx, usePatchTx, useRestoreTx, useTx, useUnlinkTransfer } from '../data';
import { etb, fullDate, kindLabel, money, title } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { Button, CategoryBadge, ErrorState, Row, Section, Spinner, useBackButton, useMainButton, useToast, WebBack } from '../ui';

export function TxDetail({ id }: { id: number }) {
  const [, go] = useLocation();
  const back = () => history.back();
  useBackButton(back);
  const tx = useTx(id);
  const patch = usePatchTx(id);
  const del = useDeleteTx();
  const restore = useRestoreTx();
  const unlink = useUnlinkTransfer(id);
  const recat = useRecategorize();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [sms, setSms] = useState<string | null>(null);

  const noteValue = tx.data ? [tx.data.note, ...tx.data.tags.map((x) => `#${x}`)].filter(Boolean).join(' ') : '';
  useEffect(() => setNote(noteValue), [noteValue]);
  const noteDirty = tx.data !== undefined && note.trim() !== noteValue;

  const mainButton = useMainButton(
    noteDirty
      ? {
          text: t('detail.save'),
          loading: patch.isPending,
          onClick: () =>
            patch.mutate(
              { note },
              {
                onSuccess: () => {
                  haptic.success();
                  toast(t('settings.saved'));
                },
              },
            ),
        }
      : null,
  );

  if (tx.isLoading) return <Spinner />;
  if (tx.error || !tx.data) return <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />;
  const d = tx.data;

  return (
    <div className="px-3 pt-3">
      <WebBack onBack={back} />
      <div className="mb-5 flex flex-col items-center text-center">
        <CategoryBadge icon={d.internal ? '🔁' : d.categoryIcon} />
        <p className="mt-2 text-[15px] text-hint">{title(d)}</p>
        <p className={`tabular text-[34px] font-semibold tracking-tight ${d.direction === 'in' ? 'text-in' : ''}`}>
          {d.direction === 'in' ? '+' : '−'}
          {money(d.amount)}
        </p>
        <p className="text-[13px] text-hint">
          {kindLabel(d.kind)}
          {d.counterpartyMaskedId ? ` · ${d.counterpartyMaskedId}` : ''}
        </p>
        {d.deleted && <p className="mt-2 rounded-full bg-danger/10 px-3 py-1 text-sm text-danger">{t('tx.deleted')}</p>}
      </div>

      {d.reconciliation === 'gap' && d.reconciliationDelta !== null && (
        <div className="mb-4 rounded-2xl bg-warn/10 px-4 py-3 text-[14px] leading-snug">
          ⚠️{' '}
          {t('detail.gap', {
            amount: etb(Math.abs(d.reconciliationDelta)),
            which: d.reconciliationDelta > 0 ? t('detail.gap.in') : t('detail.gap.out'),
          })}
        </div>
      )}
      {d.internal && (
        <div className="mb-4 rounded-2xl bg-accent/10 px-4 py-3 text-[14px] leading-snug">
          🔁 {t('detail.transfer', { account: d.transferPeerAccount ?? '—' })}{' '}
          <button className="text-link" onClick={() => unlink.mutate(undefined, { onSuccess: () => toast(t('settings.saved')) })}>
            {t('detail.unlink')}
          </button>
        </div>
      )}

      <Section>
        <Row onClick={() => recat.open(d.id, d.categoryId)} right={<span className="text-hint">›</span>}>
          <span className="text-[13px] text-hint">{t('detail.category')}</span>
          <div>
            {d.categoryIcon} {d.categoryName ?? '—'}
          </div>
        </Row>
        <div className="px-4 py-2.5">
          <span className="text-[13px] text-hint">{t('detail.note')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('detail.notePlaceholder')}
            className="mt-0.5 w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-hint/70"
          />
        </div>
      </Section>
      {mainButton}

      <Section>
        <Detail label={t('detail.when')} value={`${d.occurredAtEstimated ? '~' : ''}${fullDate(d.occurredAt)}${d.occurredAtEstimated ? ` (${t('tx.estimated')})` : ''}`} />
        <Detail label={t('detail.account')} value={d.accountName} />
        {d.fee > 0 && <Detail label={t('detail.fees')} value={etb(d.fee)} />}
        {d.vat > 0 && <Detail label={t('detail.vat')} value={etb(d.vat)} />}
        {d.otherCharges > 0 && <Detail label={t('detail.other')} value={etb(d.otherCharges)} />}
        {d.balanceAfter !== null && <Detail label={t('detail.balance')} value={etb(d.balanceAfter)} />}
        {d.reference && <Detail label={t('detail.reference')} value={<code className="text-[13px]">{d.reference}</code>} />}
        {d.receiptUrl && (
          <Row>
            <a href={d.receiptUrl} target="_blank" rel="noreferrer noopener" className="text-link">
              {t('detail.openReceipt')} ↗
            </a>
          </Row>
        )}
      </Section>

      <Section title={t('detail.sms')}>
        {sms === null ? (
          <Row onClick={() => void api<{ body: string }>(`/transactions/${id}/sms`).then((r) => setSms(r.body))}>
            <span className="text-link">{t('detail.showSms')}</span>
          </Row>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-[14px] leading-snug text-hint">{sms}</pre>
        )}
      </Section>

      <div className="mb-8">
        {d.deleted ? (
          <Button kind="secondary" className="w-full" onClick={() => restore.mutate(d.id)}>
            {t('detail.restore')}
          </Button>
        ) : (
          <Button
            kind="danger"
            className="w-full"
            onClick={() =>
              del.mutate(d.id, {
                onSuccess: () => {
                  haptic.warning();
                  toast(t('tx.deleted'), { label: t('tx.undo'), run: () => restore.mutate(d.id) });
                  go('/transactions');
                },
              })
            }
          >
            {t('detail.delete')}
          </Button>
        )}
      </div>
      {recat.element}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-sep px-4 py-3 last:border-b-0">
      <span className="text-[15px] text-hint">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
