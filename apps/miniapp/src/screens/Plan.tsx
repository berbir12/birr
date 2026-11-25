import type { BudgetDto, GoalDto } from '@birr/shared';
import { CircleAlert, CircleCheck, PiggyBank, Plus, Repeat, Target, TriangleAlert, Users } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { CategoryPicker } from '../components/CategoryPicker';
import { planApi, planKeys, useBudgets, useCategories, useGoals, usePeople, usePlanMutation, useRecurring, keys } from '../data';
import { etb, fromLocalInput, fullDate, moneyShort, parseEtb } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { CategoryIcon } from '../theme';
import { Button, Empty, Field, inputClass, PageHeader, ProgressBar, ProgressRing, Row, Section, SectionLink, Sheet, Spinner, useToast } from '../ui';
import { Avatar } from './Insights';

const STATE = {
  ok: { icon: CircleCheck, color: 'var(--color-accent)', label: 'plan.state.ok' },
  warning: { icon: TriangleAlert, color: 'var(--birr-warn)', label: 'plan.state.warning' },
  over: { icon: CircleAlert, color: 'var(--birr-over)', label: 'plan.state.over' },
} as const;

export function Plan() {
  const budgets = useBudgets();
  const goals = useGoals();
  const recurring = useRecurring();
  const people = usePeople();
  const [, go] = useLocation();
  const [editBudget, setEditBudget] = useState<{ categoryId: number; name: string; amount: number | null } | null>(null);
  const [pickCategory, setPickCategory] = useState(false);
  const [goalSheet, setGoalSheet] = useState<GoalDto | 'new' | null>(null);
  const cats = useCategories();

  const openPeople = (people.data ?? []).filter((p) => p.balance !== 0).slice(0, 3);
  const topPeople = openPeople.length ? openPeople : (people.data ?? []).slice(0, 3);

  return (
    <div className="px-4 pt-4">
      <PageHeader title={t('plan.title')} />

      {/* Budgets */}
      <Section
        title={t('plan.budgets')}
        action={
          budgets.data?.budgets.length ? (
            <span className="text-[13px] text-hint">{t('plan.budgets.daysLeft', { n: budgets.data.month.daysLeft })}</span>
          ) : undefined
        }
      >
        {budgets.isLoading && <div className="p-4"><Spinner /></div>}
        {budgets.data?.budgets.length === 0 && <Empty title={t('plan.budgets')} body={t('plan.budgets.empty')} icon={Target} />}
        {budgets.data?.budgets.map((b) => <BudgetRow key={b.categoryId} b={b} onClick={() => setEditBudget({ categoryId: b.categoryId, name: b.name, amount: b.amount })} />)}
        <button onClick={() => setPickCategory(true)} className="flex w-full items-center gap-2 px-4 py-3.5 text-[16px] font-medium text-link active:bg-bg2">
          <Plus size={18} /> {t('plan.budgets.add')}
        </button>
      </Section>

      {/* Goals */}
      <Section title={t('plan.goals')}>
        {goals.data?.length === 0 && <Empty title={t('plan.goals')} body={t('plan.goals.empty')} icon={PiggyBank} />}
        {goals.data?.map((g) => (
          <button key={g.id} onClick={() => setGoalSheet(g)} className="flex w-full items-center gap-4 border-b border-sep px-4 py-3.5 text-left active:bg-bg2">
            <ProgressRing pct={g.pct} size={52} color={g.achievedAt ? 'var(--birr-in)' : 'var(--color-accent)'}>
              <span className="text-[18px]">{g.emoji || '🎯'}</span>
            </ProgressRing>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold">{g.name}</p>
              <p className="tabular text-[13px] text-hint">{t('plan.goals.of', { saved: etb(g.saved), target: etb(g.target) })}</p>
              <p className="mt-0.5 text-[13px] font-medium">
                {g.achievedAt ? (
                  <span className="text-in">✓ {t('plan.goals.achieved')}</span>
                ) : g.overdue ? (
                  <span className="text-warn">{t('plan.goals.overdue')}</span>
                ) : g.suggestedWeekly ? (
                  <span className="text-accent">{t('plan.goals.weekly', { amount: etb(g.suggestedWeekly) })}</span>
                ) : null}
              </p>
            </div>
            <span className="tabular text-[15px] font-bold">{g.pct}%</span>
          </button>
        ))}
        <button onClick={() => setGoalSheet('new')} className="flex w-full items-center gap-2 px-4 py-3.5 text-[16px] font-medium text-link active:bg-bg2">
          <Plus size={18} /> {t('plan.goals.add')}
        </button>
      </Section>

      {/* Recurring */}
      <Section title={t('plan.recurring')} action={recurring.data?.items.length ? <SectionLink onClick={() => go('/recurring')}>{t('home.seeAll')}</SectionLink> : undefined}>
        {recurring.data?.items.length === 0 && <Empty title={t('plan.recurring')} body={t('plan.recurring.empty')} icon={Repeat} />}
        {!!recurring.data?.items.length && (
          <>
            <div className="border-b border-sep px-4 py-3">
              <p className="text-[13px] text-hint">{t('plan.recurring.total')}</p>
              <p className="tabular text-[22px] font-bold">{etb(recurring.data.monthlyTotal)}</p>
            </div>
            {recurring.data.items.slice(0, 3).map((r) => (
              <Row
                key={r.id}
                left={<CategoryIcon categoryKey={r.categoryKey} size={32} />}
                onClick={() => go('/recurring')}
                right={<span className="tabular text-[15px] font-semibold">{moneyShort(r.avgAmount)}</span>}
              >
                <span className="block truncate text-[15px]">{r.label}</span>
                <span className="text-[12px] text-hint">{t('plan.recurring.next', { date: fullDate(r.nextExpectedAt).replace(/,.*$/, '') })}</span>
              </Row>
            ))}
          </>
        )}
      </Section>

      {/* People & debts */}
      <Section title={t('plan.people')} action={people.data?.length ? <SectionLink onClick={() => go('/people')}>{t('home.seeAll')}</SectionLink> : undefined}>
        {people.data?.length === 0 && <Empty title={t('plan.people')} body={t('plan.people.empty')} icon={Users} action={<Button kind="secondary" icon={Plus} onClick={() => go('/people?new=1')}>{t('debt.add')}</Button>} />}
        {topPeople.map((p) => (
          <Row key={p.id} left={<Avatar name={p.name} />} onClick={() => go(`/people/${p.id}`)} chevron right={<Balance cents={p.balance} />}>
            <span className="block truncate text-[15px]">{p.name}</span>
          </Row>
        ))}
      </Section>

      <CategoryPicker
        open={pickCategory}
        current={null}
        title={t('plan.budgets.pick')}
        exclude={['income', 'transfers']}
        onClose={() => setPickCategory(false)}
        onPick={(id) => {
          setPickCategory(false);
          const c = cats.data?.find((x) => x.id === id);
          const existing = budgets.data?.budgets.find((b) => b.categoryId === id);
          setEditBudget({ categoryId: id, name: c?.name ?? '', amount: existing?.amount ?? null });
        }}
      />
      <BudgetSheet value={editBudget} onClose={() => setEditBudget(null)} />
      <GoalSheet value={goalSheet} onClose={() => setGoalSheet(null)} />
    </div>
  );
}

function BudgetRow({ b, onClick }: { b: BudgetDto; onClick: () => void }) {
  const s = STATE[b.state];
  return (
    <button onClick={onClick} className="block w-full border-b border-sep px-4 py-3.5 text-left active:bg-bg2">
      <div className="mb-2 flex items-center gap-3">
        <CategoryIcon categoryKey={b.categoryKey} emoji={b.icon} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{b.name}</p>
          <p className="tabular text-[12px] text-hint">
            {etb(b.spent)} / {etb(b.amount)}
          </p>
        </div>
        <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: s.color }}>
          <s.icon size={14} /> {t(s.label)}
        </span>
      </div>
      <ProgressBar pct={b.pct} color={s.color} />
      <div className="mt-1.5 flex justify-between text-[12px] text-hint">
        <span>{b.remaining >= 0 ? t('plan.budgets.left', { amount: etb(b.remaining) }) : t('plan.budgets.over', { amount: etb(-b.remaining) })}</span>
        {b.projected !== null && b.state !== 'over' && b.projected > b.amount && <span className="text-warn">{t('plan.budgets.projected', { amount: etb(b.projected) })}</span>}
      </div>
    </button>
  );
}

export function Balance({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-[13px] text-hint">{t('plan.people.settled')}</span>;
  return cents > 0 ? (
    <span className="tabular text-[13px] font-semibold text-in">{t('plan.people.owesYou', { amount: etb(cents) })}</span>
  ) : (
    <span className="tabular text-[13px] font-semibold text-warn">{t('plan.people.youOwe', { amount: etb(-cents) })}</span>
  );
}

function BudgetSheet({ value, onClose }: { value: { categoryId: number; name: string; amount: number | null } | null; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const toast = useToast();
  const invalidate = [planKeys.budgets, keys.summary];
  const save = usePlanMutation(planApi.setBudget, invalidate);
  const remove = usePlanMutation(planApi.deleteBudget, invalidate);
  const [key, setKey] = useState<number | null>(null);
  if (value && key !== value.categoryId) {
    setKey(value.categoryId);
    setAmount(value.amount ? String(value.amount / 100) : '');
  }
  if (!value && key !== null) setKey(null);
  const cents = parseEtb(amount);
  return (
    <Sheet open={value !== null} onClose={onClose} title={value ? `${t('plan.budgets.edit')} · ${value.name}` : ''}>
      <Section>
        <Field label={t('plan.budgets.amount')}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} tabular text-[22px] font-semibold`} placeholder="0" />
        </Field>
      </Section>
      <div className="grid gap-2">
        <Button
          disabled={!cents || save.isPending}
          onClick={() =>
            save.mutate(
              { categoryId: value!.categoryId, amount: cents! },
              { onSuccess: () => (haptic.success(), toast(t('settings.saved')), onClose()) },
            )
          }
        >
          {t('common.save')}
        </Button>
        {value?.amount && (
          <Button kind="danger" onClick={() => remove.mutate(value.categoryId, { onSuccess: onClose })}>
            {t('plan.budgets.remove')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function GoalSheet({ value, onClose }: { value: GoalDto | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const inv = [planKeys.goals];
  const create = usePlanMutation(planApi.createGoal, inv);
  const contribute = usePlanMutation(planApi.contribute, inv);
  const archive = usePlanMutation(planApi.archiveGoal, inv);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [amount, setAmount] = useState('');
  const [openFor, setOpenFor] = useState<unknown>(null);
  if (value !== openFor) {
    setOpenFor(value);
    setName('');
    setEmoji('');
    setTarget('');
    setDeadline('');
    setAmount('');
  }

  if (value === 'new') {
    const cents = parseEtb(target);
    return (
      <Sheet open onClose={onClose} title={t('plan.goals.add')}>
        <Section>
          <div className="flex">
            <Field label="Emoji">
              <input value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} className={`${inputClass} w-12`} placeholder="💻" />
            </Field>
            <div className="flex-1">
              <Field label={t('plan.goals.name')}>
                <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Laptop" />
              </Field>
            </div>
          </div>
          <Field label={t('plan.goals.target')}>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClass} tabular`} placeholder="60,000" />
          </Field>
          <Field label={t('plan.goals.deadline')}>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
          </Field>
        </Section>
        <Button
          className="w-full"
          disabled={!name.trim() || !cents || create.isPending}
          onClick={() =>
            create.mutate(
              { name: name.trim(), emoji: emoji.trim() || null, target: cents!, deadline: deadline ? fromLocalInput(`${deadline}T23:59`) : null },
              { onSuccess: () => (haptic.success(), onClose()) },
            )
          }
        >
          {t('common.save')}
        </Button>
      </Sheet>
    );
  }

  const g = value;
  const cents = parseEtb(amount);
  return (
    <Sheet open={g !== null} onClose={onClose} title={g ? `${g.emoji ?? '🎯'} ${g.name}` : ''}>
      {g && (
        <>
          <div className="mb-5 flex flex-col items-center">
            <ProgressRing pct={g.pct} size={112} color={g.achievedAt ? 'var(--birr-in)' : 'var(--color-accent)'}>
              <span className="tabular text-[22px] font-bold">{g.pct}%</span>
            </ProgressRing>
            <p className="tabular mt-2 text-[14px] text-hint">{t('plan.goals.of', { saved: etb(g.saved), target: etb(g.target) })}</p>
            {g.suggestedWeekly ? <p className="mt-1 text-[14px] font-medium text-accent">{t('plan.goals.weekly', { amount: etb(g.suggestedWeekly) })}</p> : null}
          </div>
          <Section>
            <Field label={t('debt.amount')}>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} tabular text-[20px] font-semibold`} placeholder="0" />
            </Field>
          </Section>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Button
              kind="secondary"
              disabled={!cents}
              onClick={() => contribute.mutate({ id: g.id, amount: -cents! }, { onSuccess: () => (setAmount(''), toast(t('settings.saved'))) })}
            >
              {t('plan.goals.withdraw')}
            </Button>
            <Button
              disabled={!cents}
              onClick={() =>
                contribute.mutate(
                  { id: g.id, amount: cents! },
                  {
                    onSuccess: (r) => {
                      setAmount('');
                      haptic.success();
                      toast(r.achievedAt ? `🎉 ${t('plan.goals.achieved')}` : t('settings.saved'));
                      onClose();
                    },
                  },
                )
              }
            >
              {t('plan.goals.add.money')}
            </Button>
          </div>
          <Button kind="plain" className="w-full text-danger" onClick={() => archive.mutate(g.id, { onSuccess: onClose })}>
            {t('plan.goals.archive')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
