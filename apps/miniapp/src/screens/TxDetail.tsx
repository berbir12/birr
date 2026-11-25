import { ArrowLeftRight, ExternalLink, FileText, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../api';
import { useRecategorize } from '../components/Recategorize';
import { useDeleteTx, usePatchTx, useRestoreTx, useTx, useUnlinkTransfer } from '../data';
import { etb, fullDate, kindLabel, money, title } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { CategoryIcon } from '../theme';
import { Button, ErrorState, Row, Section, Spinner, useBackButton, useMainButton, useToast, WebBack } from '../ui';

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

  if (tx.isLoading) return <div className="px-4"><Spinner /></div>;
  if (tx.error || !tx.data) return <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />;
  const d = tx.data;

  return (
    <div className="px-4 pt-3">
      <WebBack onBack={back} />
      <div className="mb-6 flex flex-col items-center pt-2 text-center">
        <CategoryIcon categoryKey={d.categoryKey} emoji={d.categoryIcon} internal={d.internal} size={60} />
        <p className="mt-3 text-[16px] font-medium">{title(d)}</p>
        <p className={`tabular mt-0.5 text-[38px] font-bold tracking-tight ${d.direction === 'in' ? 'text-in' : ''}`}>
          {d.direction === 'in' ? '+' : '−'}
          {money(d.amount)}
        </p>
        <p className="text-[13px] text-hint">
          {kindLabel(d.kind)}
          {d.counterpartyMaskedId ? ` · ${d.counterpartyMaskedId}` : ''}
        </p>
        {d.deleted && <p className="mt-2 rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">{t('tx.deleted')}</p>}
      </div>

      {d.reconciliation === 'gap' && d.reconciliationDelta !== null && (
        <div className="mb-4 flex gap-3 rounded-[18px] px-4 py-3 text-[14px] leading-snug" style={{ background: 'color-mix(in srgb, var(--birr-warn) 12%, transparent)' }}>
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <span>
            {t('detail.gap', {
              amount: etb(Math.abs(d.reconciliationDelta)),
              which: d.reconciliationDelta > 0 ? t('detail.gap.in') : t('detail.gap.out'),
            })}
          </span>
        </div>
      )}
      {d.internal && (
        <div className="mb-4 flex gap-3 rounded-[18px] bg-accent/10 px-4 py-3 text-[14px] leading-snug">
          <ArrowLeftRight size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {t('detail.transfer', { account: d.transferPeerAccount ?? '—' })}{' '}
            <button className="font-medium text-link" onClick={() => unlink.mutate(undefined, { onSuccess: () => toast(t('settings.saved')) })}>
              {t('detail.unlink')}
            </button>
          </span>
        </div>
      )}

      <Section>
        <Row onClick={() => recat.open(d.id, d.categoryId)} chevron left={<CategoryIcon categoryKey={d.categoryKey} emoji={d.categoryIcon} size={32} />}>
          <span className="block text-[12px] text-hint">{t('detail.category')}</span>
          <span className="text-[16px]">{d.categoryName ?? '—'}</span>
        </Row>
        <div className="px-4 py-3">
          <span className="text-[12px] font-medium text-hint">{t('detail.note')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('detail.notePlaceholder')}
            className="mt-0.5 w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-hint/60"
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
            <a href={d.receiptUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 text-[16px] text-link">
              {t('detail.openReceipt')} <ExternalLink size={14} />
            </a>
          </Row>
        )}
      </Section>

      <Section title={t('detail.sms')}>
        {sms === null ? (
          <Row onClick={() => void api<{ body: string }>(`/transactions/${id}/sms`).then((r) => setSms(r.body))}>
            <span className="flex items-center gap-2 text-[16px] text-link">
              <FileText size={16} /> {t('detail.showSms')}
            </span>
          </Row>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-[14px] leading-snug text-hint">{sms}</pre>
        )}
      </Section>

      <div className="mb-8">
        {d.deleted ? (
          <Button kind="secondary" icon={Undo2} className="w-full" onClick={() => restore.mutate(d.id)}>
            {t('detail.restore')}
          </Button>
        ) : (
          <Button
            kind="danger"
            icon={Trash2}
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
    <div className="flex items-baseline justify-between gap-4 border-b border-sep px-4 py-3 text-[16px] last:border-b-0">
      <span className="text-hint">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
