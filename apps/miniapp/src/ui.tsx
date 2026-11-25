/** Shared UI components. Native-feeling inside Telegram, light and dark. */
import { ChevronLeft, ChevronRight, CircleAlert, Inbox, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { money, moneyShort } from './format';
import { t } from './i18n';
import { insideTelegram, setBackButton, setMainButton, type MainButtonSpec } from './telegram';

// ---------------------------------------------------------------- layout

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-end justify-between gap-3 px-1 pt-2">
      <div className="min-w-0">
        {subtitle && <p className="text-[13px] font-medium text-hint">{subtitle}</p>}
        <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function Section({
  title,
  children,
  footer,
  action,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-6 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between px-1">
          {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      <div className="card overflow-hidden">{children}</div>
      {footer && <p className="mt-2 px-1 text-[13px] leading-snug text-hint">{footer}</p>}
    </section>
  );
}

export function SectionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[15px] font-medium text-link active:opacity-60">
      {children}
      <ChevronRight size={16} strokeWidth={2.5} />
    </button>
  );
}

export function Row({
  children,
  onClick,
  right,
  left,
  chevron,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
  left?: ReactNode;
  chevron?: boolean;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`group flex w-full items-center gap-3 pl-4 text-left ${onClick ? 'active:bg-bg2' : ''} ${className}`}>
      {left}
      <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 border-b border-sep py-2.5 pr-4 group-last:border-b-0">
        <div className="min-w-0 flex-1">{children}</div>
        {right}
        {chevron && <ChevronRight size={18} className="shrink-0 text-hint/60" />}
      </div>
    </Tag>
  );
}

/** iOS-settings style coloured square icon. */
export function IconTile({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: color }}>
      <Icon size={17} strokeWidth={2.2} />
    </div>
  );
}

// ---------------------------------------------------------------- money

/** Signed amount for lists: green for money in, plain for money out. */
export function Amount({ cents, direction, className = '' }: { cents: number; direction: 'in' | 'out'; className?: string }) {
  return (
    <span className={`tabular whitespace-nowrap font-semibold ${direction === 'in' ? 'text-in' : 'text-text'} ${className}`}>
      {direction === 'in' ? '+' : '−'}
      {money(cents)}
    </span>
  );
}

/** Headline figure: small "ETB", big whole birr, smaller cents. */
export function Money({
  cents,
  size = 34,
  sign,
  className = '',
  short,
}: {
  cents: number;
  size?: number;
  sign?: '+' | '−';
  className?: string;
  short?: boolean;
}) {
  const [whole, frac] = money(cents).split('.');
  return (
    <span className={`tabular inline-flex items-baseline font-bold tracking-tight ${className}`} style={{ fontSize: size, lineHeight: 1.1 }}>
      <span className="mr-1 font-semibold opacity-60" style={{ fontSize: size * 0.42 }}>
        {sign}ETB
      </span>
      {short ? moneyShort(cents) : whole}
      {!short && <span style={{ fontSize: size * 0.55 }}>.{frac}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- feedback

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-hint/15 ${className}`} />;
}

export function Spinner({ label = t('common.loading') }: { label?: string }) {
  return (
    <div className="space-y-3 py-4" role="status" aria-label={label}>
      <Skeleton className="h-28" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}

export function InlineSpinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as { status?: number })?.status;
  const msg = status === 403 ? t('common.private') : status === 401 ? t('common.openInTelegram') : t('common.offline');
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <CircleAlert size={36} className="mb-3 text-hint" />
      <p className="font-medium">{msg}</p>
      {onRetry && status !== 403 && status !== 401 && (
        <Button kind="secondary" className="mt-4" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, body, icon: Icon = Inbox, action }: { title: string; body?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon size={26} />
      </div>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-[14px] leading-snug text-hint">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- controls

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
  className = '',
  type = 'button',
  icon: Icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'plain';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  icon?: LucideIcon;
}) {
  const styles = {
    primary: 'bg-accent text-accent-text',
    secondary: 'bg-accent/10 text-accent',
    danger: 'bg-danger/10 text-danger',
    plain: 'text-link',
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-[16px] font-semibold transition active:scale-[0.98] active:opacity-80 disabled:opacity-40 ${styles} ${className}`}
    >
      {Icon && <Icon size={18} strokeWidth={2.2} />}
      {children}
    </button>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors ${
        active ? 'bg-accent text-accent-text' : 'card text-text'
      }`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[12px] bg-hint/12 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[10px] px-2 py-1.5 text-[13px] font-semibold transition ${o.value === value ? 'bg-section shadow-sm' : 'text-hint'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${checked ? 'bg-[#34c759]' : 'bg-hint/30'}`}
    >
      <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-[2px]'}`} />
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block border-b border-sep px-4 py-2.5 last:border-b-0">
      <span className="block text-[12px] font-medium text-hint">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'mt-0.5 w-full bg-transparent text-[17px] outline-none placeholder:text-hint/60';

export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-hint/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 3 : 0))}%`, background: color }} />
    </div>
  );
}

export function ProgressRing({ pct, size = 56, color, children }: { pct: number; size?: number; color: string; children?: ReactNode }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-hint/15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Bottom sheet with a dimmed backdrop. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label={t('common.cancel')} className="animate-fade absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="animate-sheet relative max-h-[88vh] overflow-y-auto rounded-t-[22px] bg-bg2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-hint/35" />
        {title && <h3 className="mb-4 text-center text-[17px] font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, action?: Toast['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string, action?: Toast['action']) => {
    const id = next.current++;
    setToasts((ts) => [...ts.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), action ? 5000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((x) => (
          <div key={x.id} className="animate-rise pointer-events-auto flex items-center gap-4 rounded-2xl bg-[#1c1c1e]/95 px-4 py-3 text-[15px] text-white shadow-xl">
            <span>{x.text}</span>
            {x.action && (
              <button
                className="font-semibold text-[#64b5ff]"
                onClick={() => {
                  x.action!.run();
                  setToasts((ts) => ts.filter((y) => y.id !== x.id));
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- Telegram buttons as hooks

/** Shows Telegram's BackButton while mounted (no-op in a browser; screens show their own). */
export function useBackButton(onBack: (() => void) | null) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const enabled = onBack !== null;
  useEffect(() => {
    if (!enabled) return setBackButton(null);
    return setBackButton(() => ref.current?.());
  }, [enabled]);
}

/** Drives Telegram's MainButton. Outside Telegram, returns a fallback button to render inline. */
export function useMainButton(spec: MainButtonSpec | null): ReactNode {
  const ref = useRef(spec);
  ref.current = spec;
  const text = spec?.text;
  const enabled = spec ? spec.enabled !== false : false;
  const loading = Boolean(spec?.loading);
  useEffect(() => {
    if (!text) return setMainButton(null);
    return setMainButton({ text, enabled, loading, onClick: () => ref.current?.onClick() });
  }, [text, enabled, loading]);
  if (!spec || insideTelegram()) return null;
  return (
    <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 mb-4 mt-2">
      <Button className="w-full shadow-lg" onClick={spec.onClick} disabled={spec.enabled === false || spec.loading}>
        {spec.loading ? <InlineSpinner /> : spec.text}
      </Button>
    </div>
  );
}

/** Browser-only back link (Telegram shows its own BackButton). */
export function WebBack({ onBack }: { onBack: () => void }) {
  if (insideTelegram()) return null;
  return (
    <button onClick={onBack} className="-ml-1 mb-1 flex items-center text-[17px] text-link active:opacity-60">
      <ChevronLeft size={22} />
      Back
    </button>
  );
}
