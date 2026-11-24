/** Fixed-window in-memory rate limiter. Fine for a single-process, single-user server. */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Records a hit; returns false when the key is over its limit for the current window. */
  hit(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.count++;
    return h.count <= this.limit;
  }

  private sweep(now: number) {
    for (const [k, h] of this.hits) if (now - h.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
