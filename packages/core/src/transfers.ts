/**
 * Internal transfers: money moving between two of MY accounts (CBE → telebirr, telebirr → CBE,
 * CBE → Cash at an ATM…) shows up as an "out" on one account and an "in" on another with the
 * same amount, close in time. Linked pairs count as neither spending nor income.
 */

export interface TransferCandidate {
  id: number;
  accountId: number;
  direction: 'in' | 'out';
  kind: string;
  amount: number;
  occurredAt: number;
  /** True when the time came from SMS arrival rather than the SMS text (CBE). */
  occurredAtEstimated: boolean;
  counterpartyName: string | null;
  transferGroupId: string | null;
}

export interface TransferMatchOptions {
  /** Max time between the legs when both times are exact. */
  windowMs?: number;
  /** Max time when either leg's time is estimated. */
  estimatedWindowMs?: number;
}

const OUT_KINDS = new Set(['wallet_to_bank', 'bank_to_wallet', 'transfer_out', 'debit', 'cash_out']);
const IN_KINDS = new Set(['bank_to_wallet', 'wallet_to_bank', 'transfer_in', 'credit', 'cash_in']);
/** Kinds that by themselves say "this is a move between institutions", not a payment to a person. */
const MOVE_KINDS = new Set(['wallet_to_bank', 'bank_to_wallet', 'debit', 'credit', 'cash_out']);
const INSTITUTION = /\b(bank|cbe|telebirr|ethio ?telecom|wallet|atm)\b/i;

const looksLikeMove = (t: TransferCandidate) => MOVE_KINDS.has(t.kind) || INSTITUTION.test(t.counterpartyName ?? '');

/**
 * Returns [outId, inId] pairs. Each transaction is used at most once; already-linked ones are skipped.
 * Closest-in-time pairs win. A person-to-person transfer_out and transfer_in are only paired when one
 * side names an institution, so paying Abebe 500 while Selam sends you 500 is not "internal".
 */
export function matchInternalTransfers(
  txs: readonly TransferCandidate[],
  opts: TransferMatchOptions = {},
): Array<[number, number]> {
  const windowMs = opts.windowMs ?? 30 * 60_000;
  const estimatedWindowMs = opts.estimatedWindowMs ?? 6 * 60 * 60_000;

  const free = txs.filter((t) => t.transferGroupId === null);
  const outs = free.filter((t) => t.direction === 'out' && OUT_KINDS.has(t.kind));
  const ins = free.filter((t) => t.direction === 'in' && IN_KINDS.has(t.kind));

  const candidates: Array<{ out: TransferCandidate; in: TransferCandidate; gap: number }> = [];
  for (const o of outs) {
    for (const i of ins) {
      if (o.accountId === i.accountId || o.amount !== i.amount) continue;
      if (!looksLikeMove(o) && !looksLikeMove(i)) continue;
      // The incoming leg can't land long before the outgoing one; allow small clock skew.
      const gap = i.occurredAt - o.occurredAt;
      const limit = o.occurredAtEstimated || i.occurredAtEstimated ? estimatedWindowMs : windowMs;
      if (gap < -Math.min(limit, 5 * 60_000) || gap > limit) continue;
      candidates.push({ out: o, in: i, gap: Math.abs(gap) });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap || a.out.id - b.out.id);

  const used = new Set<number>();
  const pairs: Array<[number, number]> = [];
  for (const c of candidates) {
    if (used.has(c.out.id) || used.has(c.in.id)) continue;
    used.add(c.out.id);
    used.add(c.in.id);
    pairs.push([c.out.id, c.in.id]);
  }
  return pairs;
}
