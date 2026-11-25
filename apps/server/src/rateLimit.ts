/**
 * Fixed-window rate limiter backed by the database, so every serverless instance shares the
 * same counters. One upsert per hit.
 */
import { lt, sql } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { rateLimits } from './db/schema.js';

export class RateLimiter {
  constructor(
    private readonly db: DB,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Records a hit; resolves false when the key is over its limit for the current window. */
  async hit(key: string, now = Date.now()): Promise<boolean> {
    const expired = sql`${rateLimits.windowStart} <= ${now - this.windowMs}`;
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key: `${this.name}:${key}`, windowStart: now, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
          windowStart: sql`case when ${expired} then ${now} else ${rateLimits.windowStart} end`,
        },
      })
      .returning({ count: rateLimits.count });
    return (row?.count ?? 1) <= this.limit;
  }
}

/** Housekeeping for the daily cron: drop counters whose window ended long ago. */
export async function purgeRateLimits(db: DB, olderThanMs = 24 * 60 * 60 * 1000, now = Date.now()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, now - olderThanMs));
}
