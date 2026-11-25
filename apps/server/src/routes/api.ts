/**
 * Mini App API routes (mounted under /api, behind initData auth in app.ts).
 * Every query is scoped to the signed-in user; ids from the client are never trusted on their own.
 */
import type { TxPatchResult } from '@birr/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { importFindings, logIngest } from '../bot/index.js';
import { decrypt } from '../crypto.js';
import type { DB } from '../db/client.js';
import { accounts, rawMessages, transactions } from '../db/schema.js';
import type { Env } from '../env.js';
import { cancelImport, commitImport, ImportError, previewEntries, previewImport } from '../services/importer.js';
import { revokeIngestSecret, rotateIngestSecret } from '../services/ingestSecret.js';
import { unlinkTransfer } from '../services/postprocess.js';
import { listTransactions, summary, txDetail } from '../services/queries.js';
import { dismissReview, listReview, resolveReview, retryReview } from '../services/review.js';
import {
  allCategories,
  createCategory,
  deleteAllData,
  deleteRule,
  listRules,
  settingsOf,
  updateCategory,
  updateSettings,
} from '../services/settings.js';
import { createRuleFromTx, editTx, restore, setCategory, softDelete } from '../services/transactions.js';

const cents = z.number().int().min(0).max(1e14);
const id = z.coerce.number().int().positive();

const PreviewBody = z.union([
  z.object({ fileName: z.string().min(1).max(200), content: z.string().min(1) }),
  z.object({
    fileName: z.string().min(1).max(200),
    format: z.enum(['xml', 'csv', 'txt']),
    inFile: z.number().int().min(0),
    entries: z
      .array(z.object({ sender: z.string().max(100).nullable(), body: z.string().min(1).max(5000), receivedAt: z.number().nullable() }))
      .max(20_000),
  }),
]);

const ListQuery = z.object({
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  accountId: id.optional(),
  categoryId: id.optional(),
  personId: id.optional(),
  direction: z.enum(['in', 'out']).optional(),
  kind: z.string().max(40).optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(),
  reconciliation: z.literal('gap').optional(),
});

const TxPatchBody = z
  .object({
    categoryId: id.optional(),
    note: z.string().max(500).optional(),
    amount: cents.positive().optional(),
    counterpartyName: z.string().max(120).optional(),
  })
  .strict();

const ResolveBody = z.object({
  source: z.enum(['telebirr', 'cbe']),
  direction: z.enum(['in', 'out']),
  kind: z.string().min(1).max(40),
  amount: cents.positive(),
  fee: cents.optional(),
  vat: cents.optional(),
  otherCharges: cents.optional(),
  balanceAfter: cents.nullable().optional(),
  counterpartyName: z.string().max(120).nullable().optional(),
  occurredAt: z.number().int().positive(),
  categoryId: id.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const SettingsBody = z
  .object({
    locale: z.enum(['en', 'am']),
    calendarMode: z.enum(['gregorian', 'ethiopian']),
    digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    digestEnabled: z.boolean(),
    largeTxThreshold: cents,
    lowBalanceThreshold: cents,
  })
  .partial()
  .strict();

const CategoryBody = z.object({ name: z.string().trim().min(1).max(40), icon: z.string().max(8).nullable().optional(), isSpending: z.boolean().optional() });
const CategoryPatch = z
  .object({
    name: z.string().trim().min(1).max(40),
    nameAm: z.string().trim().max(40).nullable(),
    icon: z.string().max(8).nullable(),
    archived: z.boolean(),
    isSpending: z.boolean(),
  })
  .partial()
  .strict();

export function registerApiRoutes(api: Hono<AppEnv>, deps: { db: DB; encKey: Buffer; env: Env }) {
  const { db, encKey, env } = deps;
  const json = async <T extends z.ZodTypeAny>(c: { req: { json(): Promise<unknown> } }, schema: T) =>
    schema.safeParse(await c.req.json().catch(() => null)) as z.ZodSafeParseResult<z.infer<T>>;
  const paramId = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);
  const bad = { error: 'bad_request' } as const;
  const notFound = { error: 'not_found' } as const;

  // ---------------- Home ----------------
  api.get('/summary', async (c) => c.json(await summary(db, c.get('user').id, c.get('user').timezone)));

  api.get('/accounts', async (c) => {
    const rows = await db.select().from(accounts).where(eq(accounts.userId, c.get('user').id)).orderBy(accounts.id);
    return c.json(rows.map((a) => ({ id: a.id, type: a.type, name: a.name, maskedId: a.maskedId, balance: a.balance, balanceAt: a.balanceAt })));
  });

  api.get('/categories', async (c) => c.json(await allCategories(db, c.get('user').id)));

  // ---------------- Transactions ----------------
  api.get('/transactions', async (c) => {
    const q = ListQuery.safeParse(c.req.query());
    if (!q.success) return c.json(bad, 400);
    return c.json(await listTransactions(db, c.get('user').id, q.data));
  });

  api.get('/transactions/:id', async (c) => {
    const txId = paramId(c.req.param('id'));
    const t = txId === null ? null : await txDetail(db, c.get('user').id, txId);
    return t ? c.json(t) : c.json(notFound, 404);
  });

  /** The original SMS text, decrypted on demand only. */
  api.get('/transactions/:id/sms', async (c) => {
    const txId = paramId(c.req.param('id'));
    if (txId === null) return c.json(notFound, 404);
    const [row] = await db
      .select({ body: rawMessages.bodyEnc, sender: rawMessages.sender, receivedAt: rawMessages.receivedAt })
      .from(transactions)
      .innerJoin(rawMessages, eq(rawMessages.id, transactions.rawMessageId))
      .where(and(eq(transactions.id, txId), eq(transactions.userId, c.get('user').id)))
      .limit(1);
    if (!row) return c.json(notFound, 404);
    return c.json({ sender: row.sender, receivedAt: row.receivedAt, body: decrypt(row.body, encKey) });
  });

  api.patch('/transactions/:id', async (c) => {
    const txId = paramId(c.req.param('id'));
    const body = await json(c, TxPatchBody);
    if (txId === null || !body.success) return c.json(bad, 400);
    const uid = c.get('user').id;
    if (!(await txDetail(db, uid, txId))) return c.json(notFound, 404);
    const p = body.data;
    if (p.categoryId !== undefined && !(await setCategory(db, uid, txId, p.categoryId))) return c.json(bad, 400);
    if (p.amount !== undefined) await editTx(db, uid, txId, 'amount', p.amount);
    if (p.counterpartyName !== undefined) await editTx(db, uid, txId, 'counterpartyName', p.counterpartyName);
    if (p.note !== undefined) await editTx(db, uid, txId, 'note', p.note);
    const tx = (await txDetail(db, uid, txId))!;
    const result: TxPatchResult = {
      tx,
      rulePrompt:
        p.categoryId !== undefined && tx.counterparty && tx.categoryName
          ? { counterparty: tx.counterparty, categoryId: p.categoryId, categoryName: tx.categoryName }
          : null,
    };
    return c.json(result);
  });

  api.post('/transactions/:id/rule', async (c) => {
    const txId = paramId(c.req.param('id'));
    const body = await json(c, z.object({ categoryId: id }));
    if (txId === null || !body.success) return c.json(bad, 400);
    const r = await createRuleFromTx(db, c.get('user').id, txId, body.data.categoryId);
    return r ? c.json(r) : c.json(bad, 400);
  });

  api.delete('/transactions/:id', async (c) => {
    const txId = paramId(c.req.param('id'));
    if (txId === null) return c.json(notFound, 404);
    return c.json({ deleted: await softDelete(db, c.get('user').id, txId) });
  });

  api.post('/transactions/:id/restore', async (c) => {
    const txId = paramId(c.req.param('id'));
    if (txId === null) return c.json(notFound, 404);
    return c.json({ restored: await restore(db, c.get('user').id, txId) });
  });

  api.post('/transactions/:id/unlink-transfer', async (c) => {
    const txId = paramId(c.req.param('id'));
    if (txId === null) return c.json(notFound, 404);
    return c.json({ unlinked: await unlinkTransfer(db, c.get('user').id, txId) });
  });

  // ---------------- Review queue ----------------
  api.get('/review', async (c) => c.json(await listReview(db, encKey, c.get('user').id)));

  api.post('/review/:id/resolve', async (c) => {
    const rid = paramId(c.req.param('id'));
    const body = await json(c, ResolveBody);
    if (rid === null || !body.success) return c.json(bad, 400);
    const txId = await resolveReview(db, c.get('user').id, rid, body.data);
    return txId ? c.json({ txId }) : c.json(notFound, 404);
  });

  api.post('/review/:id/dismiss', async (c) => {
    const rid = paramId(c.req.param('id'));
    if (rid === null) return c.json(notFound, 404);
    return c.json({ dismissed: await dismissReview(db, c.get('user').id, rid) });
  });

  api.post('/review/retry', async (c) => {
    const body = await json(c, z.object({ ids: z.array(id).max(1000).optional() }));
    if (!body.success) return c.json(bad, 400);
    const out = await retryReview(db, encKey, c.get('user').id, body.data.ids);
    return c.json({ created: out.filter((o) => o.status === 'created').length, stillInReview: out.filter((o) => o.status === 'review').length });
  });

  // ---------------- Reconciliation ----------------
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

  // ---------------- Import ----------------
  api.post('/import/preview', async (c) => {
    const parsed = await json(c, PreviewBody);
    if (!parsed.success) return c.json({ error: 'bad_body' }, 400);
    const d = parsed.data;
    const uid = c.get('user').id;
    try {
      return c.json(
        'content' in d
          ? await previewImport({ db, encKey }, uid, d.fileName, d.content)
          : await previewEntries({ db, encKey }, uid, d.fileName, d.format, d.entries, d.inFile),
      );
    } catch (e) {
      if (e instanceof ImportError) return c.json({ error: 'import_error', message: e.message }, 422);
      throw e;
    }
  });

  api.post('/import/:id/commit', async (c) => {
    const iid = paramId(c.req.param('id'));
    if (iid === null) return c.json(notFound, 404);
    const userId = c.get('user').id;
    try {
      const r = await commitImport({ db, encKey }, userId, iid);
      await logIngest(db, userId, r.outcomes);
      const created = r.outcomes.flatMap((o) => (o.status === 'created' ? [o.txId] : []));
      return c.json({ counts: r.counts, ...(await importFindings(db, userId, created)) });
    } catch (e) {
      if (e instanceof ImportError) return c.json({ error: 'import_error', message: e.message }, 409);
      throw e;
    }
  });

  api.post('/import/:id/cancel', async (c) => {
    const iid = paramId(c.req.param('id'));
    if (iid === null) return c.json(notFound, 404);
    return c.json({ cancelled: await cancelImport(db, c.get('user').id, iid) });
  });

  // ---------------- Settings ----------------
  api.get('/settings', (c) => c.json(settingsOf(c.get('user'), env.PUBLIC_URL)));

  api.patch('/settings', async (c) => {
    const body = await json(c, SettingsBody);
    if (!body.success) return c.json(bad, 400);
    return c.json(settingsOf(await updateSettings(db, c.get('user').id, body.data), env.PUBLIC_URL));
  });

  /** Shows the new token exactly once. */
  api.post('/settings/ingest-secret', async (c) => {
    const token = await rotateIngestSecret(db, encKey, c.get('user').id);
    return c.json({ url: `${env.PUBLIC_URL}/ingest/sms`, token });
  });

  api.delete('/settings/ingest-secret', async (c) => {
    await revokeIngestSecret(db, c.get('user').id);
    return c.json({ revoked: true });
  });

  api.post('/categories', async (c) => {
    const body = await json(c, CategoryBody);
    if (!body.success) return c.json(bad, 400);
    return c.json(await createCategory(db, c.get('user').id, body.data));
  });

  api.patch('/categories/:id', async (c) => {
    const cid = paramId(c.req.param('id'));
    const body = await json(c, CategoryPatch);
    if (cid === null || !body.success) return c.json(bad, 400);
    const r = await updateCategory(db, c.get('user').id, cid, body.data);
    return r ? c.json(r) : c.json(notFound, 404);
  });

  api.get('/rules', async (c) => c.json(await listRules(db, c.get('user').id)));

  api.delete('/rules/:id', async (c) => {
    const rid = paramId(c.req.param('id'));
    if (rid === null) return c.json(notFound, 404);
    return c.json({ deleted: await deleteRule(db, c.get('user').id, rid) });
  });

  /** Irreversible. The client must send the exact confirmation phrase. */
  api.post('/me/delete', async (c) => {
    const body = await json(c, z.object({ confirm: z.literal('DELETE') }));
    if (!body.success) return c.json({ error: 'confirmation_required' }, 400);
    await deleteAllData(db, c.get('user').id);
    return c.json({ deleted: true });
  });
}
