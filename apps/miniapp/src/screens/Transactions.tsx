import type { TxFilters } from '@birr/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useRecategorize } from '../components/Recategorize';
import { groupByDay, TxRow } from '../components/TxRow';
import { useAccounts, useCategories, useDeleteTx, useRestoreTx, useTransactions } from '../data';
import { fromLocalInput, money, parseEtb } from '../format';
import { t } from '../i18n';
import { Button, Chip, Empty, ErrorState, Field, inputClass, Section, Sheet, Spinner, useToast } from '../ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function Transactions() {
  const search = new URLSearchParams(useSearch());
  const [, go] = useLocation();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<TxFilters>(() => ({
    accountId: search.get('accountId') ? Number(search.get('accountId')) : undefined,
    categoryId: search.get('categoryId') ? Number(search.get('categoryId')) : undefined,
    reconciliation: search.get('gaps') ? 'gap' : undefined,
  }));
  const [sheet, setSheet] = useState(false);
  const debouncedQ = useDebounced(q.trim(), 300);
  const query = useMemo(() => ({ ...filters, q: debouncedQ || undefined }), [filters, debouncedQ]);

  const list = useTransactions(query);
  const accounts = useAccounts();
  const cats = useCategories();
  const recat = useRecategorize();
  const del = useDeleteTx();
  const restore = useRestoreTx();
  const toast = useToast();

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const groups = useMemo(() => groupByDay(items), [items]);
  const activeCount = [filters.accountId, filters.categoryId, filters.minAmount, filters.maxAmount, filters.from, filters.to, filters.reconciliation].filter(
    (x) => x !== undefined,
  ).length;
  const accountName = accounts.data?.find((a) => a.id === filters.accountId)?.name;
  const category = cats.data?.find((c) => c.id === filters.categoryId);

  return (
    <div className="pt-3">
      <div className="sticky top-0 z-10 bg-bg2 px-3 pb-2 pt-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('tx.search')}
          type="search"
          className="w-full rounded-xl bg-section px-4 py-2.5 text-[16px] outline-none placeholder:text-hint"
        />
        <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3">
          <Chip active={!filters.direction} onClick={() => setFilters((f) => ({ ...f, direction: undefined }))}>
            {t('tx.all')}
          </Chip>
          <Chip active={filters.direction === 'out'} onClick={() => setFilters((f) => ({ ...f, direction: 'out' }))}>
            {t('tx.out')}
          </Chip>
          <Chip active={filters.direction === 'in'} onClick={() => setFilters((f) => ({ ...f, direction: 'in' }))}>
            {t('tx.in')}
          </Chip>
          {accountName && <Chip active onClick={() => setFilters((f) => ({ ...f, accountId: undefined }))}>{accountName} ✕</Chip>}
          {category && (
            <Chip active onClick={() => setFilters((f) => ({ ...f, categoryId: undefined }))}>
              {category.icon} {category.name} ✕
            </Chip>
          )}
          {filters.reconciliation && <Chip active onClick={() => setFilters((f) => ({ ...f, reconciliation: undefined }))}>⚠️ gaps ✕</Chip>}
          <Chip active={activeCount > 0} onClick={() => setSheet(true)}>
            ⚙︎ {t('tx.filters')}
            {activeCount ? ` (${activeCount})` : ''}
          </Chip>
        </div>
      </div>

      <div className="px-3">
        {list.isLoading && <Spinner />}
        {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && items.length === 0 && (
          <Section>
            <Empty title={t('tx.none')} icon="🔎" />
          </Section>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mb-3">
            <div className="flex justify-between px-4 pb-1 pt-2 text-[13px] text-hint">
              <span className="font-medium uppercase tracking-wide">{g.label}</span>
              <span className="tabular">
                {g.net >= 0 ? '+' : '−'}
                {money(g.net)}
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl bg-section">
              {g.items.map((tx) => (
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
            </div>
          </section>
        ))}
        <div ref={sentinel} className="h-8" />
        {list.isFetchingNextPage && <Spinner label={t('tx.loadMore')} />}
      </div>

      <FilterSheet open={sheet} onClose={() => setSheet(false)} value={filters} onApply={(f) => (setFilters(f), setSheet(false))} />
      {recat.element}
    </div>
  );
}

function FilterSheet({ open, onClose, value, onApply }: { open: boolean; onClose: () => void; value: TxFilters; onApply: (f: TxFilters) => void }) {
  const accounts = useAccounts();
  const cats = useCategories();
  const [f, setF] = useState(value);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!open) return;
    setF(value);
    setMin(value.minAmount !== undefined ? String(value.minAmount / 100) : '');
    setMax(value.maxAmount !== undefined ? String(value.maxAmount / 100) : '');
    setFrom(value.from ? new Date(value.from + 3 * 3600_000).toISOString().slice(0, 10) : '');
    setTo(value.to ? new Date(value.to - 1 + 3 * 3600_000).toISOString().slice(0, 10) : '');
  }, [open, value]);

  const apply = () =>
    onApply({
      ...f,
      minAmount: min ? (parseEtb(min) ?? undefined) : undefined,
      maxAmount: max ? (parseEtb(max) ?? undefined) : undefined,
      from: from ? fromLocalInput(`${from}T00:00`) : undefined,
      to: to ? fromLocalInput(`${to}T00:00`) + 86400_000 : undefined,
    });

  return (
    <Sheet open={open} onClose={onClose} title={t('tx.filters')}>
      <Section title={t('tx.account')}>
        <div className="flex flex-wrap gap-2 p-3">
          <Chip active={!f.accountId} onClick={() => setF({ ...f, accountId: undefined })}>
            {t('tx.all')}
          </Chip>
          {accounts.data?.map((a) => (
            <Chip key={a.id} active={f.accountId === a.id} onClick={() => setF({ ...f, accountId: a.id })}>
              {a.name}
            </Chip>
          ))}
        </div>
      </Section>
      <Section title={t('tx.category')}>
        <div className="flex flex-wrap gap-2 p-3">
          <Chip active={!f.categoryId} onClick={() => setF({ ...f, categoryId: undefined })}>
            {t('tx.all')}
          </Chip>
          {cats.data
            ?.filter((c) => !c.archived)
            .map((c) => (
              <Chip key={c.id} active={f.categoryId === c.id} onClick={() => setF({ ...f, categoryId: c.id })}>
                {c.icon} {c.name}
              </Chip>
            ))}
        </div>
      </Section>
      <Section title={t('tx.amount')}>
        <div className="grid grid-cols-2">
          <Field label={t('tx.min')}>
            <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} className={inputClass} placeholder="0" />
          </Field>
          <Field label={t('tx.max')}>
            <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} className={inputClass} placeholder="∞" />
          </Field>
        </div>
      </Section>
      <Section title={t('tx.dates')}>
        <div className="grid grid-cols-2">
          <Field label={t('tx.from')}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          <Field label={t('tx.to')}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <Button kind="secondary" onClick={() => onApply({ direction: f.direction })}>
          {t('tx.clear')}
        </Button>
        <Button onClick={apply}>{t('tx.apply')}</Button>
      </div>
    </Sheet>
  );
}
