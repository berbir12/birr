/**
 * POST /ingest/sms — called by a phone automation (iOS Shortcuts / Android SMS forwarder).
 *
 * Auth: `Authorization: Bearer <secret>` (preferred), `X-Birr-Token: <secret>`, or `?token=` for
 * forwarder apps that can't set headers. Body: JSON or form with { sender?, body, received_at? }.
 */
import { detectSource } from '@birr/parser';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import type { Env } from '../env.js';
import { RateLimiter } from '../rateLimit.js';
import { ingestBatch, type IngestOutcome } from '../services/ingest.js';
import { userForSecret } from '../services/ingestSecret.js';
import { logAction } from '../services/transactions.js';
import type { User } from '../services/users.js';

export type Notify = (user: User, outcomes: IngestOutcome[]) => Promise<void>;

const Payload = z.object({
  sender: z.string().max(64).optional().nullable(),
  body: z.string().min(1).max(5000),
  received_at: z.union([z.string().max(64), z.number()]).optional().nullable(),
});

/** Accepts ISO strings (with offset), unix seconds or unix ms; anything odd falls back to now. */
export function parseReceivedAt(v: string | number | null | undefined, now = Date.now()): number {
  let ms: number;
  if (typeof v === 'number') ms = v < 1e12 ? v * 1000 : v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) ms = Number(v) < 1e12 ? Number(v) * 1000 : Number(v);
  else ms = v ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms > now + 5 * 60_000 || ms < Date.UTC(2015, 0, 1)) return now;
  return ms;
}

function clientIp(c: Parameters<typeof getConnInfo>[0]): string {
  // Behind Caddy the socket address is the proxy; Caddy sets X-Forwarded-For.
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function ingestRoutes(deps: { db: DB; env: Env; encKey: Buffer; notify?: Notify }) {
  const { db, env, encKey, notify } = deps;
  const perUser = new RateLimiter(env.INGEST_RATE_LIMIT_PER_MIN);
  const perIp = new RateLimiter(env.INGEST_RATE_LIMIT_PER_MIN * 2);
  const failedAuth = new RateLimiter(10);
  const app = new Hono();

  app.post('/sms', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const ip = clientIp(c);
    if (!perIp.hit(ip)) return c.json({ ok: false, error: 'rate_limited' }, 429);

    const auth = c.req.header('authorization');
    const secret =
      (auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined) ??
      c.req.header('x-birr-token') ??
      c.req.query('token') ??
      '';
    const user = secret ? userForSecret(db, encKey, secret) : null;
    if (!user) {
      if (!failedAuth.hit(ip)) return c.json({ ok: false, error: 'rate_limited' }, 429);
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (!env.ALLOWED_TELEGRAM_IDS.includes(user.telegramId)) return c.json({ ok: false, error: 'forbidden' }, 403);
    if (!perUser.hit(`u:${user.id}`)) return c.json({ ok: false, error: 'rate_limited' }, 429);

    let raw: unknown;
    const type = c.req.header('content-type') ?? '';
    try {
      raw = type.includes('application/json') ? await c.req.json() : await c.req.parseBody();
    } catch {
      return c.json({ ok: false, error: 'bad_body' }, 400);
    }
    const parsed = Payload.safeParse(raw);
    if (!parsed.success) return c.json({ ok: false, error: 'bad_body' }, 400);
    const { sender, body, received_at } = parsed.data;

    // A saved contact name (e.g. "Telebirr 127") won't match a known sender id; let the body decide.
    const knownSender = sender && detectSource(sender, '') ? sender : null;
    const [outcome] = ingestBatch({ db, encKey }, user.id, 'webhook', [
      { body, sender: knownSender, receivedAt: parseReceivedAt(received_at) },
    ]);
    if (outcome!.status === 'created') {
      logAction(db, user.id, { action: 'ingest', payload: { txIds: [outcome!.txId], rawIds: [outcome!.rawId] } });
    }
    if (notify) await notify(user, [outcome!]).catch(() => {});

    return c.json({
      ok: true,
      status: outcome!.status,
      ...(outcome!.status === 'created' || outcome!.status === 'duplicate' ? { txId: outcome!.txId } : {}),
    });
  });

  return app;
}
