import type { TxListItem } from '@birr/shared';
import { useRef, useState, type PointerEvent } from 'react';
import { dayKey, dayLabel, money, time, title } from '../format';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { Amount, CategoryBadge } from '../ui';

const REVEAL = 84;

/**
 * A transaction row with swipe actions: swipe left → delete, swipe right → change category.
 * Vertical scrolling wins over horizontal swipes (axis decided on the first few pixels).
 */
export function TxRow({
  tx,
  onOpen,
  onDelete,
  onCategory,
}: {
  tx: TxListItem;
  onOpen: () => void;
  onDelete?: () => void;
  onCategory?: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null; base: number } | null>(null);
  const moved = useRef(false);

  const down = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, axis: null, base: dx };
    moved.current = false;
  };
  const move = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.axis && Math.hypot(mx, my) > 8) s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (s.axis !== 'x') return;
    moved.current = true;
    const limit = (v: number) => Math.max(onDelete ? -REVEAL * 1.4 : 0, Math.min(onCategory ? REVEAL * 1.4 : 0, v));
    setDx(limit(s.base + mx));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (s?.axis !== 'x') return;
    const snapped = dx < -REVEAL / 2 ? -REVEAL : dx > REVEAL / 2 ? REVEAL : 0;
    if (snapped !== 0 && snapped !== s.base) haptic.select();
    setDx(snapped);
  };

  const sub = [tx.categoryName, tx.internal ? t('tx.internal') : null, tx.accountName].filter(Boolean).join(' · ');

  return (
    <div className="relative overflow-hidden border-b border-sep last:border-b-0">
      {onCategory && (
        <button
          className="absolute inset-y-0 left-0 flex w-[84px] items-center justify-center bg-accent text-sm font-medium text-accent-text"
          onClick={() => {
            setDx(0);
            onCategory();
          }}
          tabIndex={dx > 0 ? 0 : -1}
        >
          🏷 {t('tx.recategorize')}
        </button>
      )}
      {onDelete && (
        <button
          className="absolute inset-y-0 right-0 flex w-[84px] items-center justify-center bg-danger text-sm font-medium text-white"
          onClick={() => {
            setDx(0);
            haptic.warning();
            onDelete();
          }}
          tabIndex={dx < 0 ? 0 : -1}
        >
          🗑 {t('tx.delete')}
        </button>
      )}
      <button
        className="relative flex w-full touch-pan-y items-center gap-3 bg-section px-4 py-3 text-left transition-transform active:bg-bg2"
        style={{ transform: `translateX(${dx}px)`, transitionDuration: start.current ? '0ms' : '180ms' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (moved.current) return;
          if (dx !== 0) return setDx(0);
          onOpen();
        }}
      >
        <CategoryBadge icon={tx.internal ? '🔁' : tx.categoryIcon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{title(tx)}</span>
            {tx.reconciliation === 'gap' && <span title="possible missing SMS">⚠️</span>}
          </div>
          <div className="truncate text-[13px] text-hint">{sub}</div>
        </div>
        <div className="text-right">
          <Amount cents={tx.amount} direction={tx.direction} />
          <div className="text-[12px] text-hint">
            {tx.occurredAtEstimated ? '~' : ''}
            {time(tx.occurredAt)}
            {tx.charges ? ` · fee ${money(tx.charges)}` : ''}
          </div>
        </div>
      </button>
    </div>
  );
}

/** Groups a newest-first list by local day with a header and the day's net amount. */
export function groupByDay(items: readonly TxListItem[]) {
  const groups: Array<{ key: string; label: string; net: number; items: TxListItem[] }> = [];
  for (const tx of items) {
    const key = dayKey(tx.occurredAt);
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(tx.occurredAt), net: 0, items: [] };
      groups.push(g);
    }
    g.items.push(tx);
    // Same rules as the monthly totals: moving my own money (internal transfers, "Transfers")
    // is neither in nor out, but fees always count.
    const ownMove = tx.internal || tx.categoryKey === 'transfers';
    if (tx.direction === 'in') g.net += ownMove ? 0 : tx.amount;
    else g.net -= (ownMove ? 0 : tx.amount) + tx.charges;
  }
  return groups;
}
