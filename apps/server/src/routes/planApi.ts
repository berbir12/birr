/** Phase 6 Mini App routes: analytics, budgets, goals, people & debts, recurring. Mounted under /api. */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import type { DB } from '../db/client.js';
import {
  analytics,
  contributeGoal,
  createDebt,
  createGoal,
  createPerson,
  deleteBudget,
  deleteDebt,
  listBudgets,
  listGoals,
  listPeople,
  listRecurring,
  personDetail,
  reopenDebt,
  setBudget,
  setRecurringStatus,
  settleCandidates,
  settleDebt,
  updateGoal,
} from '../services/plan.js';

const cents = z.number().int().min(0).max(1e14);
const id = z.coerce.number().int().positive();

export function registerPlanRoutes(api: Hono<AppEnv>, deps: { db: DB }) {
  const { db } = deps;
  const body = async <T extends z.ZodTypeAny>(c: { req: { json(): Promise<unknown> } }, schema: T) =>
    schema.safeParse(await c.req.json().catch(() => null)) as z.ZodSafeParseResult<z.infer<T>>;
  const pid = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);
  const bad = { error: 'bad_request' } as const;
  const notFound = { error: 'not_found' } as const;

  // ---- analytics
  api.get('/analytics', async (c) => {
    const range = z.enum(['month', 'last-month', '3m', 'year']).catch('month').parse(c.req.query('range'));
    return c.json(await analytics(db, c.get('user'), range));
  });

  // ---- budgets
  api.get('/budgets', async (c) => c.json(await listBudgets(db, c.get('user'))));
  api.put('/budgets/:categoryId', async (c) => {
    const cid = pid(c.req.param('categoryId'));
    const b = await body(c, z.object({ amount: cents.positive() }));
    if (cid === null || !b.success) return c.json(bad, 400);
    if (!(await setBudget(db, c.get('user').id, cid, b.data.amount))) return c.json(notFound, 404);
    return c.json(await listBudgets(db, c.get('user')));
  });
  api.delete('/budgets/:categoryId', async (c) => {
    const cid = pid(c.req.param('categoryId'));
    if (cid === null) return c.json(notFound, 404);
    await deleteBudget(db, c.get('user').id, cid);
    return c.json(await listBudgets(db, c.get('user')));
  });

  // ---- goals
  const GoalBody = z.object({
    name: z.string().trim().min(1).max(60),
    emoji: z.string().max(8).nullable().optional(),
    target: cents.positive(),
    deadline: z.number().int().positive().nullable().optional(),
    saved: cents.optional(),
  });
  api.get('/goals', async (c) => c.json(await listGoals(db, c.get('user').id)));
  api.post('/goals', async (c) => {
    const b = await body(c, GoalBody);
    if (!b.success) return c.json(bad, 400);
    return c.json(await createGoal(db, c.get('user').id, b.data));
  });
  api.patch('/goals/:id', async (c) => {
    const gid = pid(c.req.param('id'));
    const b = await body(c, GoalBody.omit({ saved: true }).partial().extend({ archived: z.boolean().optional() }).strict());
    if (gid === null || !b.success) return c.json(bad, 400);
    const g = await updateGoal(db, c.get('user').id, gid, b.data);
    return g ? c.json(g) : c.json(notFound, 404);
  });
  api.post('/goals/:id/contribute', async (c) => {
    const gid = pid(c.req.param('id'));
    const b = await body(c, z.object({ amount: z.number().int().min(-1e14).max(1e14).refine((v) => v !== 0) }));
    if (gid === null || !b.success) return c.json(bad, 400);
    const g = await contributeGoal(db, c.get('user').id, gid, b.data.amount);
    return g ? c.json(g) : c.json(notFound, 404);
  });

  // ---- people & debts
  api.get('/people', async (c) => c.json(await listPeople(db, c.get('user').id)));
  api.post('/people', async (c) => {
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(80) }));
    if (!b.success) return c.json(bad, 400);
    return c.json({ id: await createPerson(db, c.get('user').id, b.data.name) });
  });
  api.get('/people/:id', async (c) => {
    const p = pid(c.req.param('id'));
    const d = p === null ? null : await personDetail(db, c.get('user').id, p);
    return d ? c.json(d) : c.json(notFound, 404);
  });
  api.post('/debts', async (c) => {
    const b = await body(
      c,
      z
        .object({
          personId: id.optional(),
          personName: z.string().trim().min(1).max(80).optional(),
          direction: z.enum(['lent', 'borrowed']),
          amount: cents.positive(),
          note: z.string().max(200).nullable().optional(),
          dueAt: z.number().int().positive().nullable().optional(),
        })
        .refine((v) => v.personId !== undefined || v.personName !== undefined),
    );
    if (!b.success) return c.json(bad, 400);
    const d = await createDebt(db, c.get('user').id, b.data);
    return d ? c.json(d) : c.json(notFound, 404);
  });
  api.get('/debts/:id/candidates', async (c) => {
    const d = pid(c.req.param('id'));
    const r = d === null ? null : await settleCandidates(db, c.get('user').id, d);
    return r ? c.json(r) : c.json(notFound, 404);
  });
  api.post('/debts/:id/settle', async (c) => {
    const d = pid(c.req.param('id'));
    const b = await body(c, z.object({ transactionId: id.nullable() }));
    if (d === null || !b.success) return c.json(bad, 400);
    return (await settleDebt(db, c.get('user').id, d, b.data.transactionId)) ? c.json({ settled: true }) : c.json(notFound, 404);
  });
  api.post('/debts/:id/reopen', async (c) => {
    const d = pid(c.req.param('id'));
    return d !== null && (await reopenDebt(db, c.get('user').id, d)) ? c.json({ reopened: true }) : c.json(notFound, 404);
  });
  api.delete('/debts/:id', async (c) => {
    const d = pid(c.req.param('id'));
    return d !== null && (await deleteDebt(db, c.get('user').id, d)) ? c.json({ deleted: true }) : c.json(notFound, 404);
  });

  // ---- recurring
  api.get('/recurring', async (c) => c.json(await listRecurring(db, c.get('user'))));
  api.post('/recurring/:id/:action{confirm|dismiss}', async (c) => {
    const r = pid(c.req.param('id'));
    const status = c.req.param('action') === 'confirm' ? 'confirmed' : 'dismissed';
    return r !== null && (await setRecurringStatus(db, c.get('user').id, r, status)) ? c.json({ ok: true }) : c.json(notFound, 404);
  });
}
