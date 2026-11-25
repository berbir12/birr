/**
 * Conversational state for the bot ("send me the new amount…"), stored in the database because
 * on serverless the next message can arrive at a different instance.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { botState } from '../db/schema.js';
import type { EditableField } from './transactions.js';

export interface PendingEdit {
  txId: number;
  field: EditableField;
  chatId: number;
  cardMessageId: number;
}

export const PENDING_EDIT_TTL_MS = 5 * 60 * 1000;

export async function setPendingEdit(db: DB, userId: number, p: PendingEdit, now = Date.now()): Promise<void> {
  const values = { userId, pending: { ...p }, expiresAt: now + PENDING_EDIT_TTL_MS };
  await db.insert(botState).values(values).onConflictDoUpdate({ target: botState.userId, set: values });
}

/** Returns the pending edit if still valid, and clears it either way. */
export async function takePendingEdit(db: DB, userId: number, now = Date.now()): Promise<PendingEdit | null> {
  const [row] = await db.delete(botState).where(eq(botState.userId, userId)).returning();
  if (!row?.pending || !row.expiresAt || row.expiresAt < now) return null;
  return row.pending as unknown as PendingEdit;
}

export async function clearPendingEdit(db: DB, userId: number): Promise<void> {
  await db.delete(botState).where(eq(botState.userId, userId));
}
