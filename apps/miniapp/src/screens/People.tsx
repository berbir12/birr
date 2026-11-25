import type { DebtDto, TxListItem } from '@birr/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { TxRow } from '../components/TxRow';
import { debtCandidates, planApi, planKeys, usePeople, usePerson, usePlanMutation } from '../data';
import { etb, fullDate, moneyShort, parseEtb } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { Button, Empty, ErrorState, Field, inputClass, Row, Section, Segmented, Sheet, Spinner, useToast } from '../ui';
import { Avatar } from './Insights';
import { Balance } from './Plan';
import { SubPage } from './Settings';

export function PeoplePage() {
  const people = usePeople();
  const [, go] = useLocation();
  const params = new URLSearchParams(useSearch());
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(params.get('new') === '1');
  const list = useMemo(
    () => (people.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())),
    [people.data, q],
  );
  return (
    <SubPage title={t('plan.people')}>
      <div className="card mb-4 flex items-center gap-2 px-3">
        <Search size={18} className="text-hint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('debt.person')} className="w-full bg-transparent py-2.5 text-[16px] outline-none placeholder:text-hint" />
      </div>
      <Button icon={Plus} kind="secondary" className="mb-4 w-full" onClick={() => setAdd(true)}>
        {t('debt.add')}
      </Button>
      {people.isLoading && <Spinner />}
      {people.error && <ErrorState error={people.error} onRetry={() => void people.refetch()} />}
      {people.data?.length === 0 && (
        <Section>
          <Empty title={t('plan.people')} body={t('plan.people.empty')} icon={Users} />
        </Section>
      )}
      {list.length > 0 && (
        <Section>
          {list.map((p) => (
            <Row key={p.id} left={<Avatar name={p.name} />} onClick={() => go(`/people/${p.id}`)} chevron right={<Balance cents={p.balance} />}>
              <span className="block truncate text-[16px]">{p.name}</span>
              <span className="tabular text-[12px] text-hint">
                {[p.out ? `−${moneyShort(p.out)}` : null, p.in ? `+${moneyShort(p.in)}` : null, p.count ? `${p.count}×` : null].filter(Boolean).join(' · ')}
              </span>
            </Row>
          ))}
        </Section>
      )}
      <DebtSheet open={add} onClose={() => setAdd(false)} />
    </SubPage>
  );
}

export function PersonPage({ id }: { id: number }) {
  const p = usePerson(id);
  const [, go] = useLocation();
  const [add, setAdd] = useState(false);
  const [settle, setSettle] = useState<DebtDto | null>(null);
  const inv = [planKeys.person(id), planKeys.people];
  const reopen = usePlanMutation(planApi.reopenDebt, inv);
  const remove = usePlanMutation(planApi.deleteDebt, inv);

  if (p.isLoading) return <SubPage title=""><Spinner /></SubPage>;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={() => void p.refetch()} />;
  const { person, debts, recent } = p.data;

  return (
    <SubPage title={person.name}>
      <div className="card mb-6 flex items-center gap-4 p-4">
        <Avatar name={person.name} size={52} />
        <div className="min-w-0 flex-1">
          <Balance cents={person.balance} />
          <p className="tabular mt-1 text-[13px] text-hint">
            {t('plan.people.sent', { amount: etb(person.out) })} · {t('plan.people.received', { amount: etb(person.in) })}
          </p>
        </div>
      </div>

      <Section title={t('person.debts')} action={<button onClick={() => setAdd(true)} className="flex items-center gap-1 text-[15px] font-medium text-link"><Plus size={16} /> {t('debt.add')}</button>}>
        {debts.length === 0 && <p className="px-4 py-4 text-[14px] text-hint">—</p>}
        {debts.map((d) => (
          <div key={d.id} className="border-b border-sep px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">
                  {d.direction === 'lent' ? t('debt.lent') : t('debt.borrowed')} <span className="tabular">{etb(d.amount)}</span>
                </p>
                <p className="text-[12px] text-hint">
                  {fullDate(d.createdAt).replace(/,.*$/, '')}
                  {d.note ? ` · ${d.note}` : ''}
                </p>
              </div>
              {d.settledAt ? (
                <span className="flex items-center gap-1 text-[12px] font-semibold text-in">
                  <Check size={14} /> {t('debt.settledOn', { date: fullDate(d.settledAt).replace(/,.*$/, '') })}
                </span>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold text-warn" style={{ background: 'color-mix(in srgb, var(--birr-warn) 14%, transparent)' }}>
                  {t('debt.open')}
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-4 text-[14px] font-medium">
              {d.settledAt ? (
                <button className="flex items-center gap-1 text-link" onClick={() => reopen.mutate(d.id)}>
                  <RotateCcw size={14} /> {t('debt.reopen')}
                </button>
              ) : (
                <button className="flex items-center gap-1 text-link" onClick={() => setSettle(d)}>
                  <Check size={14} /> {t('debt.settle')}
                </button>
              )}
              <button className="flex items-center gap-1 text-danger" onClick={() => remove.mutate(d.id)}>
                <Trash2 size={14} /> {t('debt.delete')}
              </button>
            </div>
          </div>
        ))}
      </Section>

      {recent.length > 0 && (
        <Section title={t('person.activity')}>
          {recent.map((tx) => (
            <TxRow key={tx.id} tx={tx} onOpen={() => go(`/tx/${tx.id}`)} />
          ))}
        </Section>
      )}

      <DebtSheet open={add} personId={person.id} personName={person.name} onClose={() => setAdd(false)} />
      <SettleSheet debt={settle} onClose={() => setSettle(null)} personId={id} />
    </SubPage>
  );
}

function DebtSheet({ open, onClose, personId, personName }: { open: boolean; onClose: () => void; personId?: number; personName?: string }) {
  const people = usePeople();
  const toast = useToast();
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const create = usePlanMutation(planApi.createDebt, [planKeys.people, ...(personId ? [planKeys.person(personId)] : [])]);
  const suggestions = name.trim() && !chosen ? (people.data ?? []).filter((p) => p.name.toLowerCase().includes(name.toLowerCase())).slice(0, 4) : [];
  const cents = parseEtb(amount);
  const who = personId ?? chosen;
  return (
    <Sheet open={open} onClose={onClose} title={t('debt.add')}>
      <div className="mb-4">
        <Segmented value={direction} onChange={setDirection} options={[{ value: 'lent', label: t('debt.lent') }, { value: 'borrowed', label: t('debt.borrowed') }]} />
      </div>
      <Section>
        {personId ? (
          <Field label={t('debt.person')}>
            <p className="mt-0.5 text-[17px]">{personName}</p>
          </Field>
        ) : (
          <Field label={t('debt.person')}>
            <input value={name} onChange={(e) => (setName(e.target.value), setChosen(null))} className={inputClass} placeholder="Abebe" />
          </Field>
        )}
        {suggestions.map((p) => (
          <button key={p.id} onClick={() => (setChosen(p.id), setName(p.name))} className="flex w-full items-center gap-3 border-b border-sep px-4 py-2 text-left active:bg-bg2">
            <Avatar name={p.name} size={28} /> <span className="text-[15px]">{p.name}</span>
          </button>
        ))}
        <Field label={t('debt.amount')}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} tabular`} placeholder="0" />
        </Field>
        <Field label={t('debt.note')}>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
      </Section>
      <Button
        className="w-full"
        disabled={!cents || (!who && !name.trim()) || create.isPending}
        onClick={() =>
          create.mutate(
            { ...(who ? { personId: who } : { personName: name.trim() }), direction, amount: cents!, note: note.trim() || null },
            {
              onSuccess: () => {
                haptic.success();
                toast(t('settings.saved'));
                setName('');
                setChosen(null);
                setAmount('');
                setNote('');
                onClose();
              },
            },
          )
        }
      >
        {t('common.save')}
      </Button>
    </Sheet>
  );
}

function SettleSheet({ debt, onClose, personId }: { debt: DebtDto | null; onClose: () => void; personId: number }) {
  const cands = useQuery({ queryKey: ['debt-cands', debt?.id], queryFn: () => debtCandidates(debt!.id), enabled: debt !== null });
  const settle = usePlanMutation(planApi.settleDebt, [planKeys.person(personId), planKeys.people]);
  const done = (transactionId: number | null) =>
    settle.mutate({ id: debt!.id, transactionId }, { onSuccess: () => (haptic.success(), onClose()) });
  return (
    <Sheet open={debt !== null} onClose={onClose} title={t('debt.settleWith')}>
      {cands.isLoading && <Spinner />}
      {cands.data && cands.data.length === 0 && <p className="mb-4 text-center text-[14px] text-hint">{t('debt.noCandidates')}</p>}
      {!!cands.data?.length && (
        <Section>
          {cands.data.map((tx: TxListItem) => (
            <TxRow key={tx.id} tx={tx} onOpen={() => done(tx.id)} />
          ))}
        </Section>
      )}
      <Button kind="secondary" className="w-full" onClick={() => done(null)}>
        {t('debt.settleManual')}
      </Button>
    </Sheet>
  );
}
