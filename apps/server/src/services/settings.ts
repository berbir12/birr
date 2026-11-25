import type { CategoryDto, RuleDto, SettingsDto, SettingsPatch } from '@birr/shared';
import { and, asc, eq, max } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { categories, rules, users } from '../db/schema.js';
import type { User } from './users.js';

export function settingsOf(u: User, publicUrl: string): SettingsDto {
  return {
    locale: u.locale,
    calendarMode: u.calendarMode,
    timezone: u.timezone,
    digestTime: u.digestTime,
    digestEnabled: u.digestEnabled,
    largeTxThreshold: u.largeTxThreshold,
    lowBalanceThreshold: u.lowBalanceThreshold,
    ingest: { connected: u.ingestSecretHash !== null, rotatedAt: u.ingestSecretRotatedAt, url: `${publicUrl}/ingest/sms` },
  };
}

export async function updateSettings(db: DB, userId: number, patch: SettingsPatch): Promise<User> {
  const [u] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return u!;
}

export function toCategoryDto(c: typeof categories.$inferSelect): CategoryDto {
  return { id: c.id, key: c.key, name: c.name, nameAm: c.nameAm, icon: c.icon, isSpending: c.isSpending, archived: c.archived };
}

export async function allCategories(db: DB, userId: number): Promise<CategoryDto[]> {
  const rows = await db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.sort), asc(categories.id));
  return rows.map(toCategoryDto);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'category';

export async function createCategory(
  db: DB,
  userId: number,
  input: { name: string; icon?: string | null; isSpending?: boolean },
): Promise<CategoryDto> {
  const [{ top } = { top: 0 }] = await db.select({ top: max(categories.sort) }).from(categories).where(eq(categories.userId, userId));
  const base = `custom-${slug(input.name)}`;
  for (let n = 0; ; n++) {
    const key = n ? `${base}-${n}` : base;
    const [row] = await db
      .insert(categories)
      .values({ userId, key, name: input.name.trim(), icon: input.icon ?? null, isSpending: input.isSpending ?? true, sort: (top ?? 0) + 1 })
      .onConflictDoNothing()
      .returning();
    if (row) return toCategoryDto(row);
  }
}

export async function updateCategory(
  db: DB,
  userId: number,
  id: number,
  patch: Partial<Pick<CategoryDto, 'name' | 'nameAm' | 'icon' | 'archived' | 'isSpending'>>,
): Promise<CategoryDto | null> {
  const [row] = await db
    .update(categories)
    .set(patch)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .returning();
  return row ? toCategoryDto(row) : null;
}

export async function listRules(db: DB, userId: number): Promise<RuleDto[]> {
  const rows = await db
    .select({ id: rules.id, field: rules.field, pattern: rules.pattern, categoryId: rules.categoryId, categoryName: categories.name })
    .from(rules)
    .innerJoin(categories, eq(categories.id, rules.categoryId))
    .where(eq(rules.userId, userId))
    .orderBy(asc(rules.pattern));
  return rows;
}

export async function deleteRule(db: DB, userId: number, id: number): Promise<boolean> {
  const res = await db.delete(rules).where(and(eq(rules.id, id), eq(rules.userId, userId))).returning({ id: rules.id });
  return res.length > 0;
}

/** Deletes the user and everything they own (FK cascades). The next visit starts fresh. */
export async function deleteAllData(db: DB, userId: number): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
