/** Small shared UI pieces, styled to feel native inside Telegram (light and dark). */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from './i18n';
import { money } from './format';
import { insideTelegram, setBackButton, setMainButton, type MainButtonSpec } from './telegram';

export function Section({ title, children, footer, action }: { title?: string; children: ReactNode; footer?: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-5">
      {(title || action) && (
        <div className="mb-1.5 flex items-baseline justify-between px-4">
          {title && <h2 className="text-[13px] font-medium uppercase tracking-wide text-hint">{title}</h2>}
          {action}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl bg-section">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] leading-snug text-hint">{footer}</p>}
    </section>
  );
}

export function Row({
  children,
  onClick,
  right,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-sep px-4 py-3 text-left last:border-b-0 ${onClick ? 'active:bg-bg2' : ''} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {right}
    </Tag>
  );
}

/** Signed amount: green for money in, plain for money out. */
export function Amount({ cents, direction, className = '' }: { cents: number; direction: 'in' | 'out'; className?: string }) {
  return (
    <span className={`tabular whitespace-nowrap font-medium ${direction === 'in' ? 'text-in' : 'text-text'} ${className}`}>
      {direction === 'in' ? '+' : '−'}
      {money(cents)}
    </span>
  );
}

export function CategoryBadge({ icon, size = 'md' }: { icon: string | null; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'h-8 w-8 text-base' : 'h-10 w-10 text-xl';
  return <div className={`flex shrink-0 items-center justify-center rounded-full bg-bg2 ${s}`}>{icon ?? '📦'}</div>;
}

export function Spinner({ label = t('common.loading') }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-hint" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-hint border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as { status?: number })?.status;
  const msg = status === 403 ? t('common.private') : status === 401 ? t('common.openInTelegram') : t('common.offline');
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-danger">{msg}</p>
      {onRetry && status !== 403 && status !== 401 && (
        <button onClick={onRetry} className="mt-3 text-link">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Empty({ title, body, icon = '🌱' }: { title: string; body?: string; icon?: string }) {
  return (
    <div className="px-8 py-14 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-sm leading-snug text-hint">{body}</p>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'plain';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-accent text-accent-text',
    secondary: 'bg-bg2 text-link',
    danger: 'bg-danger/10 text-danger',
    plain: 'text-link',
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 font-medium transition-opacity active:opacity-70 disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
        active ? 'bg-accent text-accent-text' : 'bg-section text-text'
      }`}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-in' : 'bg-hint/40'}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block border-b border-sep px-4 py-2.5 last:border-b-0">
      <span className="block text-xs text-hint">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'mt-0.5 w-full bg-transparent text-[16px] outline-none placeholder:text-hint/70';

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
      <button aria-label={t('common.cancel')} className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-sheet relative max-h-[85vh] overflow-y-auto rounded-t-3xl bg-bg2 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-hint/40" />
        {title && <h3 className="mb-3 px-1 text-center font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// ---------------- toasts ----------------
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
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((x) => (
          <div key={x.id} className="animate-fade pointer-events-auto flex items-center gap-4 rounded-xl bg-black/85 px-4 py-2.5 text-sm text-white shadow-lg">
            <span>{x.text}</span>
            {x.action && (
              <button
                className="font-semibold text-sky-300"
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

// ---------------- Telegram buttons as hooks ----------------

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

/**
 * Drives Telegram's MainButton. Outside Telegram, returns a fallback button to render inline.
 */
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
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mb-3 mt-4">
      <Button className="w-full" onClick={spec.onClick} disabled={spec.enabled === false || spec.loading}>
        {spec.loading ? '…' : spec.text}
      </Button>
    </div>
  );
}

/** Browser-only back link (Telegram shows its own BackButton). */
export function WebBack({ onBack }: { onBack: () => void }) {
  if (insideTelegram()) return null;
  return (
    <button onClick={onBack} className="mb-2 px-1 text-link">
      ‹ Back
    </button>
  );
}
