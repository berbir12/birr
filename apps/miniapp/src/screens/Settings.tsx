import { detectSource, parseImportFile } from '@birr/parser';
import type { ImportSummaryDto, SettingsDto } from '@birr/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  CircleCheck,
  Copy,
  Download,
  FolderOpen,
  Globe,
  KeyRound,
  Layers,
  Plus,
  ScanSearch,
  Smartphone,
  Trash2,
  TriangleAlert,
  Upload,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { del, post } from '../api';
import { importApi, keys, useCategories, useCategoryMutations, useDeleteRule, usePatchSettings, useRules, useSettings, useSummary, type ImportResult } from '../data';
import { fullDate, money, parseEtb } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { CategoryIcon } from '../theme';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  IconTile,
  inputClass,
  PageHeader,
  Row,
  Section,
  Segmented,
  Spinner,
  Toggle,
  useBackButton,
  useMainButton,
  useToast,
  WebBack,
} from '../ui';

export function Settings() {
  const s = useSettings();
  const summary = useSummary();
  const save = usePatchSettings();
  const [, go] = useLocation();
  const toast = useToast();

  if (s.isLoading) return <div className="px-4"><Spinner /></div>;
  if (s.error || !s.data) return <ErrorState error={s.error} onRetry={() => void s.refetch()} />;
  const d = s.data;
  const update = (p: Partial<SettingsDto>) =>
    save.mutate(p, { onSuccess: () => (haptic.select(), toast(t('settings.saved'))), onError: () => toast(t('common.error')) });
  const review = summary.data?.reviewCount ?? 0;

  return (
    <div className="px-4 pt-4">
      <PageHeader title={t('settings.title')} />

      <Section>
        <Row
          left={<IconTile icon={ScanSearch} color="var(--birr-s1)" />}
          onClick={() => go('/review')}
          chevron
          right={review > 0 ? <span className="rounded-full bg-danger px-2 py-0.5 text-[13px] font-semibold text-white">{review}</span> : undefined}
        >
          {t('review.title')}
        </Row>
      </Section>

      <Section footer={d.locale === 'am' ? t('settings.language.am.soon') : d.calendarMode === 'ethiopian' ? t('settings.calendar.soon') : undefined}>
        <div className="flex items-center gap-3 border-b border-sep px-4 py-3">
          <IconTile icon={Globe} color="var(--birr-s7)" />
          <span className="flex-1 text-[16px]">{t('settings.language')}</span>
          <div className="w-40">
            <Segmented value={d.locale} onChange={(v) => update({ locale: v })} options={[{ value: 'en', label: 'English' }, { value: 'am', label: 'አማርኛ' }]} />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <IconTile icon={CalendarDays} color="var(--birr-s2)" />
          <span className="flex-1 text-[16px]">{t('settings.calendar')}</span>
          <div className="w-40">
            <Segmented
              value={d.calendarMode}
              onChange={(v) => update({ calendarMode: v })}
              options={[
                { value: 'gregorian', label: 'GC' },
                { value: 'ethiopian', label: 'ዓ.ም' },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title={t('settings.alerts')}>
        <Row left={<IconTile icon={Bell} color="var(--birr-s8)" />} right={<Toggle checked={d.digestEnabled} onChange={(v) => update({ digestEnabled: v })} label={t('settings.digest')} />}>
          <span className="text-[16px]">{t('settings.digest')}</span>
        </Row>
        {d.digestEnabled && (
          <Field label={t('settings.digestTime')}>
            <input type="time" defaultValue={d.digestTime} onBlur={(e) => e.target.value !== d.digestTime && update({ digestTime: e.target.value })} className={inputClass} />
          </Field>
        )}
        <MoneySetting label={t('settings.largeTx')} value={d.largeTxThreshold} onSave={(v) => update({ largeTxThreshold: v })} />
        <MoneySetting label={t('settings.lowBalance')} value={d.lowBalanceThreshold} onSave={(v) => update({ lowBalanceThreshold: v })} />
      </Section>

      <Section>
        <Row left={<IconTile icon={Layers} color="var(--birr-s3)" />} onClick={() => go('/settings/categories')} chevron>
          <span className="text-[16px]">{t('settings.categories')}</span>
        </Row>
        <Row left={<IconTile icon={Zap} color="var(--birr-s4)" />} onClick={() => go('/settings/rules')} chevron>
          <span className="text-[16px]">{t('settings.rules')}</span>
        </Row>
      </Section>

      <Section>
        <Row
          left={<IconTile icon={Smartphone} color="var(--birr-s1)" />}
          onClick={() => go('/settings/forwarding')}
          chevron
          right={<span className={`text-[14px] ${d.ingest.connected ? 'text-in' : 'text-hint'}`}>{d.ingest.connected ? t('fwd.connected') : t('fwd.notConnected')}</span>}
        >
          <span className="text-[16px]">{t('settings.forwarding')}</span>
        </Row>
        <Row left={<IconTile icon={Upload} color="var(--birr-s6)" />} onClick={() => go('/settings/import')} chevron>
          <span className="text-[16px]">{t('settings.import')}</span>
        </Row>
        <Row left={<IconTile icon={Download} color="var(--birr-s0)" />}>
          <span className="text-[16px] text-hint">{t('settings.export')}</span>
          <span className="block text-[12px] text-hint">{t('settings.export.soon')}</span>
        </Row>
      </Section>

      <Section>
        <Row left={<IconTile icon={Trash2} color="var(--birr-over)" />} onClick={() => go('/settings/delete')}>
          <span className="text-[16px] text-danger">{t('settings.danger')}</span>
        </Row>
      </Section>
      <p className="pb-6 text-center text-[12px] text-hint">Birr · private · Africa/Addis_Ababa</p>
    </div>
  );
}

function MoneySetting({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <Field label={label}>
      <input
        inputMode="decimal"
        defaultValue={money(value)}
        onBlur={(e) => {
          const v = parseEtb(e.target.value);
          if (v !== null && v !== value) onSave(v);
          else e.target.value = money(value);
        }}
        className={`${inputClass} tabular`}
      />
    </Field>
  );
}

export function SubPage({ title, children }: { title: string; children: React.ReactNode }) {
  const back = () => history.back();
  useBackButton(back);
  return (
    <div className="px-4 pt-3">
      <WebBack onBack={back} />
      <PageHeader title={title} />
      {children}
    </div>
  );
}

// ---------------- Categories ----------------
export function CategoriesPage() {
  const cats = useCategories();
  const { create, update } = useCategoryMutations();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const toast = useToast();

  return (
    <SubPage title={t('settings.categories')}>
      {cats.isLoading && <Spinner />}
      <Section>
        {cats.data
          ?.filter((c) => !c.archived)
          .map((c) =>
            editing === c.id ? (
              <CategoryEditor
                key={c.id}
                initial={{ name: c.name, icon: c.icon ?? '' }}
                onCancel={() => setEditing(null)}
                onSave={(v) => update.mutate({ id: c.id, name: v.name, icon: v.icon || null }, { onSuccess: () => setEditing(null) })}
                onArchive={() => update.mutate({ id: c.id, archived: true }, { onSuccess: () => setEditing(null) })}
              />
            ) : (
              <Row key={c.id} left={<CategoryIcon categoryKey={c.key} emoji={c.icon} size={32} />} onClick={() => setEditing(c.id)} chevron>
                <span className="text-[16px]">{c.name}</span>
              </Row>
            ),
          )}
      </Section>
      <Section title={t('categories.add')}>
        <div className="flex">
          <Field label={t('categories.icon')}>
            <input value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} className={`${inputClass} w-12`} placeholder="☕" />
          </Field>
          <div className="flex-1">
            <Field label={t('categories.name')}>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Coffee" />
            </Field>
          </div>
        </div>
        <div className="p-3">
          <Button
            icon={Plus}
            className="w-full"
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), icon: icon.trim() || null },
                { onSuccess: () => (setName(''), setIcon(''), haptic.success(), toast(t('settings.saved'))) },
              )
            }
          >
            {t('categories.add')}
          </Button>
        </div>
      </Section>
      {cats.data?.some((c) => c.archived) && (
        <Section title={t('categories.archived')}>
          {cats.data
            .filter((c) => c.archived)
            .map((c) => (
              <Row
                key={c.id}
                left={<CategoryIcon categoryKey={c.key} emoji={c.icon} size={32} />}
                right={
                  <button className="text-[15px] font-medium text-link" onClick={() => update.mutate({ id: c.id, archived: false })}>
                    {t('categories.unarchive')}
                  </button>
                }
              >
                <span className="text-[16px] text-hint">{c.name}</span>
              </Row>
            ))}
        </Section>
      )}
    </SubPage>
  );
}

function CategoryEditor({
  initial,
  onSave,
  onCancel,
  onArchive,
}: {
  initial: { name: string; icon: string };
  onSave: (v: { name: string; icon: string }) => void;
  onCancel: () => void;
  onArchive: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="border-b border-sep bg-bg2/60 last:border-b-0">
      <div className="flex">
        <Field label={t('categories.icon')}>
          <input value={v.icon} maxLength={4} onChange={(e) => setV({ ...v, icon: e.target.value })} className={`${inputClass} w-12`} />
        </Field>
        <div className="flex-1">
          <Field label={t('categories.name')}>
            <input autoFocus value={v.name} maxLength={40} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputClass} />
          </Field>
        </div>
      </div>
      <div className="flex gap-2 p-3">
        <Button kind="danger" onClick={onArchive}>
          {t('categories.archive')}
        </Button>
        <div className="flex-1" />
        <Button kind="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button disabled={!v.name.trim()} onClick={() => onSave({ name: v.name.trim(), icon: v.icon.trim() })}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ---------------- Rules ----------------
export function RulesPage() {
  const rules = useRules();
  const cats = useCategories();
  const remove = useDeleteRule();
  const keyOf = (id: number) => cats.data?.find((c) => c.id === id);
  return (
    <SubPage title={t('settings.rules')}>
      {rules.isLoading && <Spinner />}
      {rules.data?.length === 0 && (
        <Section>
          <Empty title={t('rules.empty')} icon={Zap} />
        </Section>
      )}
      {!!rules.data?.length && (
        <Section>
          {rules.data.map((r) => (
            <Row
              key={r.id}
              left={<CategoryIcon categoryKey={keyOf(r.categoryId)?.key} emoji={keyOf(r.categoryId)?.icon} size={32} />}
              right={
                <button className="text-[15px] font-medium text-danger" onClick={() => remove.mutate(r.id)}>
                  {t('rules.delete')}
                </button>
              }
            >
              <div className="truncate text-[16px] capitalize">{r.pattern}</div>
              <div className="flex items-center gap-1 text-[13px] text-hint">
                <ArrowLeftRight size={12} /> {r.categoryName}
              </div>
            </Row>
          ))}
        </Section>
      )}
    </SubPage>
  );
}

// ---------------- Forwarding ----------------
export function ForwardingPage() {
  const s = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [token, setToken] = useState<{ url: string; token: string } | null>(null);
  const copy = (v: string) => void navigator.clipboard?.writeText(v).then(() => (haptic.success(), toast(t('fwd.copied'))));
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.settings });
  const connected = s.data?.ingest.connected;

  return (
    <SubPage title={t('settings.forwarding')}>
      <div className="card mb-6 flex items-center gap-3 p-4">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: connected ? 'color-mix(in srgb, var(--birr-in) 14%, transparent)' : 'rgba(127,127,127,0.14)', color: connected ? 'var(--birr-in)' : 'var(--color-hint)' }}
        >
          {connected ? <CircleCheck size={22} /> : <Smartphone size={22} />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold">{connected ? t('fwd.connected') : t('fwd.notConnected')}</p>
          {s.data?.ingest.rotatedAt && <p className="text-[13px] text-hint">{fullDate(s.data.ingest.rotatedAt)}</p>}
        </div>
      </div>
      <p className="mb-3 px-1 text-[14px] leading-snug text-hint">{t('fwd.intro')}</p>
      <Section>
        <Row right={<CopyButton onClick={() => copy(s.data?.ingest.url ?? '')} />}>
          <div className="text-[12px] text-hint">URL</div>
          <code className="break-all text-[13px]">{s.data?.ingest.url}</code>
        </Row>
      </Section>
      {token && (
        <Section footer={t('fwd.tokenOnce')}>
          <Row right={<CopyButton onClick={() => copy(`Bearer ${token.token}`)} />}>
            <div className="text-[12px] text-hint">Authorization</div>
            <code className="break-all text-[13px]">Bearer {token.token}</code>
          </Row>
        </Section>
      )}
      <div className="grid gap-2">
        <Button icon={KeyRound} onClick={() => void post<{ url: string; token: string }>('/settings/ingest-secret').then((r) => (setToken(r), refresh(), haptic.success()))}>
          {t('fwd.rotate')}
        </Button>
        {connected && (
          <Button kind="danger" onClick={() => void del('/settings/ingest-secret').then(() => (setToken(null), refresh()))}>
            {t('fwd.revoke')}
          </Button>
        )}
      </div>
    </SubPage>
  );
}

function CopyButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[15px] font-medium text-link active:opacity-60">
      <Copy size={15} /> {t('fwd.copy')}
    </button>
  );
}

// ---------------- Import ----------------
export function ImportPage() {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [stage, setStage] = useState<'idle' | 'reading' | 'preview' | 'importing' | 'done'>('idle');
  const [preview, setPreview] = useState<{ importId: number; summary: ImportSummaryDto } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setStage('reading');
    try {
      const text = await file.text();
      // Read and filter on the phone: only telebirr/CBE messages are uploaded.
      const { format, entries } = parseImportFile(file.name, text);
      const relevant = entries.filter((e) => detectSource(e.sender && detectSource(e.sender, '') ? e.sender : null, e.body));
      const p = await importApi.preview({ fileName: file.name, format, inFile: entries.length, entries: relevant });
      setPreview(p);
      setStage('preview');
    } catch (e) {
      setError((e as Error).message || t('common.error'));
      setStage('idle');
    }
  };

  const commit = async () => {
    if (!preview) return;
    setStage('importing');
    try {
      const r = await importApi.commit(preview.importId);
      setResult(r);
      setStage('done');
      haptic.success();
      void qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
      setStage('preview');
    }
  };
  // Leaving the page with an unconfirmed preview discards it (only on unmount, never mid-import).
  const pendingId = useRef<number | null>(null);
  pendingId.current = stage === 'preview' && preview ? preview.importId : null;
  useEffect(
    () => () => {
      if (pendingId.current !== null) void importApi.cancel(pendingId.current).catch(() => {});
    },
    [],
  );

  const s = preview?.summary;
  const n = s ? s.created + s.review : 0;
  const mainButton = useMainButton(
    stage === 'preview' && n > 0
      ? { text: t('import.go', { n }), onClick: () => void commit() }
      : stage === 'importing'
        ? { text: t('import.go', { n }), onClick: () => {}, loading: true }
        : null,
  );

  return (
    <SubPage title={t('settings.import')}>
      <p className="mb-4 px-1 text-[14px] leading-snug text-hint">{t('import.intro')}</p>
      <input ref={input} type="file" accept=".xml,.csv,.tsv,.txt,text/*" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
      {(stage === 'idle' || stage === 'done') && (
        <Button icon={FolderOpen} className="mb-4 w-full" onClick={() => input.current?.click()}>
          {t('import.choose')}
        </Button>
      )}
      {stage === 'reading' && <Spinner label={t('import.reading')} />}
      {error && (
        <p className="mb-4 flex gap-2 rounded-[14px] bg-danger/10 px-4 py-3 text-[14px] text-danger">
          <TriangleAlert size={18} className="shrink-0" /> {error}
        </p>
      )}
      {s && (stage === 'preview' || stage === 'importing') && (
        <Section title={s.fileName}>
          <Row>{t('import.preview', { relevant: s.relevant, inFile: s.inFile })}</Row>
          <Row>
            telebirr {s.bySource.telebirr} · CBE {s.bySource.cbe}
            {s.from !== null && s.to !== null && <div className="text-[13px] text-hint">{`${fullDate(s.from)} – ${fullDate(s.to)}`}</div>}
          </Row>
          <Row>
            <span className="font-medium">{n > 0 ? t('import.counts', { created: s.created, duplicates: s.duplicates, review: s.review }) : t('import.nothing')}</span>
          </Row>
        </Section>
      )}
      {mainButton}
      {stage === 'done' && result && (
        <Section>
          <Row left={<CircleCheck size={20} className="text-in" />}>{t('import.done', { n: result.counts.created })}</Row>
          {result.linked > 0 && <Row left={<ArrowLeftRight size={20} className="text-accent" />}>{t('import.linked', { n: result.linked })}</Row>}
          {result.gaps > 0 && <Row left={<TriangleAlert size={20} className="text-warn" />}>{t('import.gaps', { n: result.gaps })}</Row>}
        </Section>
      )}
    </SubPage>
  );
}

// ---------------- Delete all ----------------
export function DeletePage() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const qc = useQueryClient();
  if (done)
    return (
      <SubPage title={t('delete.title')}>
        <Section>
          <Empty title={t('delete.done')} icon={CircleCheck} />
        </Section>
      </SubPage>
    );
  return (
    <SubPage title={t('delete.title')}>
      <p className="mb-4 px-1 text-[15px] leading-snug">{t('delete.body')}</p>
      <Section>
        <Field label="DELETE">
          <input value={text} onChange={(e) => setText(e.target.value)} className={inputClass} autoCapitalize="characters" />
        </Field>
      </Section>
      <Button
        kind="danger"
        icon={Trash2}
        className="w-full"
        disabled={text !== 'DELETE' || busy}
        onClick={() => {
          setBusy(true);
          haptic.warning();
          void post('/me/delete', { confirm: 'DELETE' }).then(() => {
            qc.clear();
            setDone(true);
          });
        }}
      >
        {t('delete.button')}
      </Button>
    </SubPage>
  );
}
