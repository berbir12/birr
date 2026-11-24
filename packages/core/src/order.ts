export interface ChainItem {
  direction: 'in' | 'out';
  amount: number;
  fee: number;
  vat: number;
  otherCharges: number;
  balanceAfter: number | null;
}

/** Signed effect of a transaction on its account balance. */
export function balanceDelta(t: Omit<ChainItem, 'balanceAfter'>): number {
  const charges = t.fee + t.vat + t.otherCharges;
  return t.direction === 'in' ? t.amount - charges : -(t.amount + charges);
}

/**
 * Orders undated messages from ONE account oldest → newest by following the balance chain:
 * b follows a when a.balanceAfter + delta(b) === b.balanceAfter.
 *
 * Returns indices into `items`. When the chain doesn't explain the order (gaps, missing balances)
 * the unexplained items keep their relative input order, appended after the longest chain found.
 * `assumeNewestFirst` reverses the fallback order (SMS apps usually list newest first).
 */
export function orderByBalanceChain(items: readonly ChainItem[], assumeNewestFirst = true): number[] {
  const n = items.length;
  if (n < 2) return items.map((_, i) => i);

  const next = new Map<number, number>();
  const hasPrev = new Set<number>();
  for (let a = 0; a < n; a++) {
    const ia = items[a]!;
    if (ia.balanceAfter === null) continue;
    for (let b = 0; b < n; b++) {
      const ib = items[b]!;
      if (a === b || ib.balanceAfter === null || hasPrev.has(b)) continue;
      if (ia.balanceAfter + balanceDelta(ib) === ib.balanceAfter) {
        next.set(a, b);
        hasPrev.add(b);
        break;
      }
    }
  }

  const fallback = items.map((_, i) => i);
  if (assumeNewestFirst) fallback.reverse();

  // Walk chains from their heads, in fallback order, so independent chains stay stable.
  const seen = new Set<number>();
  const chains: number[][] = [];
  for (const head of fallback) {
    if (hasPrev.has(head) || seen.has(head)) continue;
    const chain: number[] = [];
    for (let cur: number | undefined = head; cur !== undefined && !seen.has(cur); cur = next.get(cur)) {
      chain.push(cur);
      seen.add(cur);
    }
    chains.push(chain);
  }
  // Cycles (impossible with real data) — keep anything left in fallback order.
  for (const i of fallback) if (!seen.has(i)) chains.push([i]);

  return chains.flat();
}
