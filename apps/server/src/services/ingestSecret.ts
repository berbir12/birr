/**
 * Per-user secret for the SMS webhook. Only a keyed hash is stored; the plaintext is shown once.
 * Rotating keeps the previous secret valid for a short grace period so a phone automation
 * doesn't break between generating a new secret and pasting it into Shortcuts.
 */
import { createHmac } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { keyedHash, newSecret } from '../crypto.js';
import type { DB } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User } from './users.js';

export const SECRET_GRACE_MS = 60 * 60 * 1000;
const PREFIX = 'birr_';

function secretKey(encKey: Buffer): Buffer {
  return createHmac('sha256', encKey).update('birr/ingest-secret/v1').digest();
}

/** Generates a new secret, demoting the current one to "previous". Returns the plaintext. */
export async function rotateIngestSecret(db: DB, encKey: Buffer, userId: number, now = Date.now()): Promise<string> {
  const secret = PREFIX + newSecret(24);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  await db
    .update(users)
    .set({
      ingestSecretHash: keyedHash(secret, secretKey(encKey)),
      ingestSecretPrevHash: user?.ingestSecretHash ?? null,
      ingestSecretRotatedAt: now,
    })
    .where(eq(users.id, userId));
  return secret;
}

/** Revokes both current and previous secrets (e.g. phone lost). */
export async function revokeIngestSecret(db: DB, userId: number): Promise<void> {
  await db
    .update(users)
    .set({ ingestSecretHash: null, ingestSecretPrevHash: null, ingestSecretRotatedAt: Date.now() })
    .where(eq(users.id, userId));
}

export async function userForSecret(db: DB, encKey: Buffer, secret: string, now = Date.now()): Promise<User | null> {
  if (!secret.startsWith(PREFIX) || secret.length > 100) return null;
  const h = keyedHash(secret, secretKey(encKey));
  const [u] = await db
    .select()
    .from(users)
    .where(or(eq(users.ingestSecretHash, h), eq(users.ingestSecretPrevHash, h)))
    .limit(1);
  if (!u) return null;
  if (u.ingestSecretHash === h) return u;
  // Previous secret: only during the grace window.
  return u.ingestSecretRotatedAt !== null && now - u.ingestSecretRotatedAt <= SECRET_GRACE_MS ? u : null;
}
