import type { ReviewItem, ReviewResolveBody } from '@birr/shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useDismissReview, useResolveReview, useRetryReview, useReview } from '../data';
import { fromLocalInput, fullDate, kindLabel, parseEtb, toLocalInput } from '../format';
import { t, type MsgKey } from '../i18n';
import { haptic } from '../telegram';
import { CircleCheck, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Chip, Empty, ErrorState, Field, inputClass, PageHeader, Section, Spinner, useBackButton, useMainButton, useToast, WebBack } from '../ui';

const reasonLabel = (r: string | null) => {
  const key = `review.reason.${r ?? 'no_template'}` as MsgKey;
  try {
    return t(key);
  } catch {
    return r ?? '';
  }
};

export function Review() {
  const review = useReview();
  const retry = useRetryReview();
  const [, go] = useLocation();
  const toast = useToast();

  if (review.isLoading) return <div className="px-4"><Spinner /></div>;
  if (review.error || !review.data) return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  const items = review.data;

  return (
    <div className="px-4 pt-4">
      <PageHeader title={t('review.title')} />
      {items.length === 0 ? (
        <Section>
          <Empty title={t('review.empty')} icon={CircleCheck} />
        </Section>
      ) : (
        <>
          <p className="mb-4 px-1 text-[14px] leading-snug text-hint">{t('review.intro')}</p>
          {items.map((it) => (
            <Section key={it.id} className="mb-3">
              <button onClick={() => go(`/review/${it.id}`)} className="block w-full px-4 py-3 text-left active:bg-bg2">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-hint">
                  <span>
                    {it.sender} · {fullDate(it.receivedAt)}
                  </span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 font-semibold text-warn" style={{ background: 'color-mix(in srgb, var(--birr-warn) 14%, transparent)' }}>{reasonLabel(it.reason)}</span>
                </div>
                <p className="line-clamp-3 text-[15px] leading-snug">{it.body}</p>
              </button>
            </Section>
          ))}
          <Button
            kind="secondary"
            icon={RefreshCw}
            className="mb-6 w-full"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(undefined, {
                onSuccess: (r) => toast(t('review.retried', { created: r.created, left: r.stillInReview })),
              })
            }
          >
            {t('review.retry')}
          </Button>
        </>
      )}
    </div>
  );
}

const KINDS = ['transfer_out', 'transfer_in', 'merchant_payment', 'airtime', 'data_package', 'bill_payment', 'cash_in', 'cash_out', 'bank_to_wallet', 'wallet_to_bank', 'salary', 'credit', 'debit', 'fee_only'] as const;

function initialForm(it: ReviewItem) {
  const c = (it.candidate ?? {}) as Partial<Record<string, unknown>>;
  const cents = (v: unknown) => (typeof v === 'number' ? String(v / 100) : '');
  // Unknown formats have no candidate: guess the amount (first "ETB …") and direction from the text.
  const guessedAmount = /ETB\s*([\d,]+(?:\.\d{1,2})?)/i.exec(it.body)?.[1]?.replace(/,/g, '') ?? '';
  const guessedIn = /\b(credited|received|deposited)\b/i.test(it.body);
  return {
    source: ((c.source as string) ?? (/cbe/i.test(it.sender) || /\bCBE\b/.test(it.body) ? 'cbe' : 'telebirr')) as 'telebirr' | 'cbe',
    direction: ((c.direction as string) ?? (guessedIn ? 'in' : 'out')) as 'in' | 'out',
    kind: (c.kind as string) ?? (guessedIn ? 'credit' : 'debit'),
    amount: cents(c.amount) || guessedAmount,
    fees: typeof c.fee === 'number' ? String(((c.fee as number) + ((c.vat as number) ?? 0) + ((c.otherCharges as number) ?? 0)) / 100) : '',
    balance: cents(c.balanceAfter),
    counterparty: (c.counterpartyName as string) ?? '',
    when: toLocalInput(typeof c.occurredAt === 'string' ? Date.parse(c.occurredAt) : it.receivedAt),
  };
}

export function ReviewFix({ id }: { id: number }) {
  const review = useReview();
  const resolve = useResolveReview();
  const dismiss = useDismissReview();
  const [, go] = useLocation();
  const toast = useToast();
  const back = () => history.back();
  useBackButton(back);
  const item = review.data?.find((x) => x.id === id);
  const [f, setF] = useState<ReturnType<typeof initialForm> | null>(null);
  useEffect(() => {
    if (item && !f) setF(initialForm(item));
  }, [item, f]);

  const amount = f ? parseEtb(f.amount) : null;
  const valid = Boolean(f && amount && amount > 0 && f.when);
  const save = () => {
    if (!f || !amount) return;
    const body: ReviewResolveBody = {
      source: f.source,
      direction: f.direction,
      kind: f.kind,
      amount,
      fee: f.fees ? (parseEtb(f.fees) ?? 0) : 0,
      balanceAfter: f.balance ? parseEtb(f.balance) : null,
      counterpartyName: f.counterparty || null,
      occurredAt: fromLocalInput(f.when),
    };
    resolve.mutate(
      { id, body },
      {
        onSuccess: ({ txId }) => {
          haptic.success();
          go(`/tx/${txId}`, { replace: true });
        },
        onError: () => (haptic.error(), toast(t('common.error'))),
      },
    );
  };
  const mainButton = useMainButton(f ? { text: t('review.save'), onClick: save, enabled: valid, loading: resolve.isPending } : null);

  if (review.isLoading) return <div className="px-4"><Spinner /></div>;
  if (!item || !f) return <ErrorState error={{ status: 404 }} />;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });

  return (
    <div className="px-4 pt-3">
      <WebBack onBack={back} />
      <Section title={`${item.sender} · ${fullDate(item.receivedAt)}`}>
        <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-[14px] leading-snug">{item.body}</pre>
      </Section>

      <Section>
        <Field label={t('review.source')}>
          <div className="mt-1 flex gap-2">
            {(['telebirr', 'cbe'] as const).map((s) => (
              <Chip key={s} active={f.source === s} onClick={() => set({ source: s })}>
                {s === 'cbe' ? 'CBE' : 'telebirr'}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label={t('review.direction')}>
          <div className="mt-1 flex gap-2">
            <Chip active={f.direction === 'out'} onClick={() => set({ direction: 'out' })}>
              {t('tx.out')}
            </Chip>
            <Chip active={f.direction === 'in'} onClick={() => set({ direction: 'in' })}>
              {t('tx.in')}
            </Chip>
          </div>
        </Field>
        <Field label={t('review.kind')}>
          <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('review.amount')}>
          <input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={inputClass} placeholder="0.00" />
        </Field>
        <Field label={t('review.fees')}>
          <input inputMode="decimal" value={f.fees} onChange={(e) => set({ fees: e.target.value })} className={inputClass} placeholder="0.00" />
        </Field>
        <Field label={t('review.balance')}>
          <input inputMode="decimal" value={f.balance} onChange={(e) => set({ balance: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('review.counterparty')}>
          <input value={f.counterparty} onChange={(e) => set({ counterparty: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('review.date')}>
          <input type="datetime-local" value={f.when} onChange={(e) => set({ when: e.target.value })} className={inputClass} />
        </Field>
      </Section>
      {mainButton}

      <Button
        kind="danger"
        icon={Trash2}
        className="mb-8 w-full"
        onClick={() =>
          dismiss.mutate(id, {
            onSuccess: () => {
              haptic.tap();
              go('/review', { replace: true });
            },
          })
        }
      >
        {t('review.dismiss')}
      </Button>
    </div>
  );
}
