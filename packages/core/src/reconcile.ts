import { balanceDelta } from './order.js';

export interface ReconTx {
  id: number;
  occurredAt: number;
  direction: 'in' | 'out';
  amount: number;
  fee: number;
  vat: number;
  otherCharges: number;
  balanceAfter: number | null;
}

export interface ReconResult {
  id: number;
  /**
   * ok      balance follows from the previous known balance
   * gap     it doesn't: some SMS between the previous known balance and this one is probably missing
   * unknown no balance on this SMS, or nothing earlier to compare with (first message of the account)
   */
  status: 'ok' | 'gap' | 'unknown';
  /** For gaps: balanceAfter − expected. > 0 = unrecorded money in, < 0 = unrecorded money out. */
  delta: number | null;
  /** For gaps: the transaction carrying the previous known balance. */
  previousId: number | null;
}

/**
 * Walks one account's transactions in time order (ties by id) and checks
 * previous_balance + Σ deltas(transactions in between, incl. this one) == balance_after.
 * Transactions without a balance just accumulate into the running expectation.
 */
export function reconcile(txs: readonly ReconTx[]): ReconResult[] {
  const sorted = [...txs].sort((a, b) => a.occurredAt - b.occurredAt || a.id - b.id);
  let expected: number | null = null;
  let previousId: number | null = null;

  return sorted.map((t) => {
    const d = balanceDelta(t);
    if (t.balanceAfter === null) {
      if (expected !== null) expected += d;
      return { id: t.id, status: 'unknown', delta: null, previousId: null };
    }
    let result: ReconResult;
    if (expected === null) {
      result = { id: t.id, status: 'unknown', delta: null, previousId: null };
    } else {
      const want: number = expected + d;
      result =
        want === t.balanceAfter
          ? { id: t.id, status: 'ok', delta: null, previousId }
          : { id: t.id, status: 'gap', delta: t.balanceAfter - want, previousId };
    }
    // Re-anchor on the reported balance: an error only affects the one interval it's in.
    expected = t.balanceAfter;
    previousId = t.id;
    return result;
  });
}
