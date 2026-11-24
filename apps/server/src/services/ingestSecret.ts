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
export function rotateIngestSecret(db: DB, encKey: Buffer, userId: number, now = Date.now()): string {
  const secret = PREFIX + newSecret(24);
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  db.update(users)
    .set({
      ingestSecretHash: keyedHash(secret, secretKey(encKey)),
      ingestSecretPrevHash: user?.ingestSecretHash ?? null,
      ingestSecretRotatedAt: now,
    })
    .where(eq(users.id, userId))
    .run();
  return secret;
}

/** Revokes both current and previous secrets (e.g. phone lost). */
export function revokeIngestSecret(db: DB, userId: number): void {
  db.update(users)
    .set({ ingestSecretHash: null, ingestSecretPrevHash: null, ingestSecretRotatedAt: Date.now() })
    .where(eq(users.id, userId))
    .run();
}

export function userForSecret(db: DB, encKey: Buffer, secret: string, now = Date.now()): User | null {
  if (!secret.startsWith(PREFIX) || secret.length > 100) return null;
  const h = keyedHash(secret, secretKey(encKey));
  const u = db
    .select()
    .from(users)
    .where(or(eq(users.ingestSecretHash, h), eq(users.ingestSecretPrevHash, h)))
    .get();
  if (!u) return null;
  if (u.ingestSecretHash === h) return u;
  // Previous secret: only during the grace window.
  return u.ingestSecretRotatedAt !== null && now - u.ingestSecretRotatedAt <= SECRET_GRACE_MS ? u : null;
}
