/**
 * Mini App API routes (mounted under /api, behind initData auth in app.ts).
 * Screens arrive in Phase 5; these are the Phase 4 endpoints they will call.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { importFindings, logIngest } from '../bot/index.js';
import type { DB } from '../db/client.js';
import { accounts, transactions } from '../db/schema.js';
import { cancelImport, commitImport, ImportError, previewImport } from '../services/importer.js';
import { unlinkTransfer } from '../services/postprocess.js';

const PreviewBody = z.object({
  fileName: z.string().min(1).max(200),
  /** Raw file text. The Mini App sends files already filtered to telebirr/CBE messages to stay small. */
  content: z.string().min(1),
});

export function registerApiRoutes(api: Hono<AppEnv>, deps: { db: DB; encKey: Buffer }) {
  const { db, encKey } = deps;
  const idParam = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);

  api.post('/import/preview', async (c) => {
    const parsed = PreviewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_body' }, 400);
    try {
      return c.json(await previewImport({ db, encKey }, c.get('user').id, parsed.data.fileName, parsed.data.content));
    } catch (e) {
      if (e instanceof ImportError) return c.json({ error: 'import_error', message: e.message }, 422);
      throw e;
    }
  });

  api.post('/import/:id/commit', async (c) => {
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    const userId = c.get('user').id;
    try {
      const r = await commitImport({ db, encKey }, userId, id);
      await logIngest(db, userId, r.outcomes);
      const created = r.outcomes.flatMap((o) => (o.status === 'created' ? [o.txId] : []));
      return c.json({ counts: r.counts, ...(await importFindings(db, userId, created)) });
    } catch (e) {
      if (e instanceof ImportError) return c.json({ error: 'import_error', message: e.message }, 409);
      throw e;
    }
  });

  api.post('/import/:id/cancel', async (c) => {
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    return c.json({ cancelled: await cancelImport(db, c.get('user').id, id) });
  });

  /** "Possible missing SMS": every transaction whose balance doesn't follow from the previous one. */
  api.get('/reconciliation/gaps', async (c) => {
    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        occurredAt: transactions.occurredAt,
        delta: transactions.reconciliationDelta,
        balanceAfter: transactions.balanceAfter,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(transactions.userId, c.get('user').id), eq(transactions.reconciliation, 'gap'), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.occurredAt))
      .limit(200);
    return c.json({ gaps: rows });
  });

  api.post('/transactions/:id/unlink-transfer', async (c) => {
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'not_found' }, 404);
    return c.json({ unlinked: await unlinkTransfer(db, c.get('user').id, id) });
  });
}
