import { DEFAULT_CATEGORIES } from '@birr/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { accounts, categories, users } from '../db/schema.js';

export type User = typeof users.$inferSelect;

/**
 * Returns the user for a Telegram id, creating it with default categories and a
 * Cash wallet on first sight. Callers must have already checked the allowlist.
 */
export function ensureUser(db: DB, telegramId: number, firstName?: string): User {
  const existing = db.select().from(users).where(eq(users.telegramId, telegramId)).get();
  if (existing) return existing;

  return db.transaction((tx) => {
    const user = tx
      .insert(users)
      .values({ telegramId, firstName: firstName ?? null })
      .returning()
      .get();
    tx.insert(categories)
      .values(
        DEFAULT_CATEGORIES.map((c, i) => ({
          userId: user.id,
          key: c.key,
          name: c.name,
          nameAm: c.nameAm,
          icon: c.icon,
          isSpending: c.isSpending,
          sort: i,
        })),
      )
      .run();
    tx.insert(accounts).values({ userId: user.id, type: 'cash', name: 'Cash' }).run();
    return user;
  });
}
