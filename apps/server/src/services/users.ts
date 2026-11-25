import { DEFAULT_CATEGORIES } from '@birr/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { accounts, categories, users } from '../db/schema.js';

export type User = typeof users.$inferSelect;

/**
 * Returns the user for a Telegram id, creating it with default categories and a
 * Cash wallet on first sight. Callers must have already checked the allowlist.
 */
export async function ensureUser(db: DB, telegramId: number, firstName?: string): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    // ON CONFLICT: two first requests racing (e.g. bot + Mini App) must not both create the user.
    const [created] = await tx
      .insert(users)
      .values({ telegramId, firstName: firstName ?? null })
      .onConflictDoNothing({ target: users.telegramId })
      .returning();
    if (!created) {
      const [u] = await tx.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      return u!;
    }
    await tx.insert(categories).values(
      DEFAULT_CATEGORIES.map((c, i) => ({
        userId: created.id,
        key: c.key,
        name: c.name,
        nameAm: c.nameAm,
        icon: c.icon,
        isSpending: c.isSpending,
        sort: i,
      })),
    );
    await tx.insert(accounts).values({ userId: created.id, type: 'cash', name: 'Cash' });
    return created;
  });
}
