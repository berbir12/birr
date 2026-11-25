/**
 * Category identity: one icon and one fixed palette slot per category, used everywhere
 * (list badges, detail, budgets, charts) so a category always looks the same.
 */
import {
  ArrowLeftRight,
  Briefcase,
  Car,
  CircleDashed,
  Clapperboard,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  House,
  Lightbulb,
  Receipt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Stethoscope,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/** Slot 0 = neutral; 1–8 = the validated categorical palette, in its CVD-safe order. */
export type Slot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const CATEGORY: Record<string, { icon: LucideIcon; slot: Slot }> = {
  food: { icon: ShoppingBasket, slot: 1 },
  transport: { icon: Car, slot: 2 },
  family: { icon: Users, slot: 3 },
  rent: { icon: House, slot: 4 },
  shopping: { icon: ShoppingBag, slot: 5 },
  utilities: { icon: Lightbulb, slot: 6 },
  airtime: { icon: Smartphone, slot: 7 },
  health: { icon: Stethoscope, slot: 8 },
  equb: { icon: HandCoins, slot: 7 },
  giving: { icon: HeartHandshake, slot: 5 },
  education: { icon: GraduationCap, slot: 1 },
  entertainment: { icon: Clapperboard, slot: 2 },
  business: { icon: Briefcase, slot: 6 },
  income: { icon: Wallet, slot: 3 },
  fees: { icon: Receipt, slot: 0 },
  transfers: { icon: ArrowLeftRight, slot: 0 },
  other: { icon: CircleDashed, slot: 0 },
};

// The raw :root variables, not Tailwind's --color-sN aliases: Tailwind only emits theme variables
// whose names appear literally in the source, and these are built dynamically.
export const slotColor = (s: Slot) => `var(--birr-s${s})`;

export function categoryStyle(key: string | null | undefined): { icon: LucideIcon; slot: Slot } {
  return (key && CATEGORY[key]) || { icon: Tag, slot: 0 };
}

/**
 * Colours for one chart: each category keeps its own slot unless another category in the same
 * chart already uses it; then it takes the next free slot. Neutral grey is reserved for the
 * chart's own "everything else" bucket, so a real category (even "Other") always gets a colour.
 */
export function chartSlots(keys: readonly string[]): Map<string, Slot> {
  const used = new Set<Slot>();
  const out = new Map<string, Slot>();
  const pending: string[] = [];
  for (const k of keys) {
    const s = categoryStyle(k).slot;
    if (s === 0) pending.push(k);
    else if (!used.has(s)) {
      used.add(s);
      out.set(k, s);
    } else pending.push(k);
  }
  for (const k of pending) {
    const free = ([1, 2, 3, 4, 5, 6, 7, 8] as Slot[]).find((s) => !used.has(s));
    if (free) used.add(free);
    out.set(k, free ?? 0);
  }
  return out;
}

/** Round icon badge in the category's colour (tinted background, coloured glyph). */
export function CategoryIcon({
  categoryKey,
  emoji,
  size = 40,
  internal,
}: {
  categoryKey: string | null | undefined;
  /** Custom categories may carry an emoji instead of a known key. */
  emoji?: string | null;
  size?: number;
  internal?: boolean;
}) {
  const { icon: Icon, slot } = internal ? { icon: ArrowLeftRight, slot: 0 as Slot } : categoryStyle(categoryKey);
  const custom = !internal && categoryKey?.startsWith('custom-') && emoji;
  const color = slotColor(slot);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      aria-hidden
    >
      {custom ? <span style={{ fontSize: size * 0.48 }}>{emoji}</span> : <Icon size={size * 0.48} strokeWidth={2} />}
    </div>
  );
}
