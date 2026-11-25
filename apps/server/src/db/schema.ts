/**
 * Birr data model (Postgres via Drizzle; Supabase in production, PGlite in dev/tests).
 *
 * Conventions:
 *  - Everything lives in the `birr` schema, which Supabase does NOT expose through its public
 *    REST/GraphQL APIs, and every table has row-level security enabled with no policies, so
 *    nothing is readable through Supabase's anon/authenticated roles even if exposure changes.
 *    The app connects as the database owner, which bypasses RLS.
 *  - Money is integer cents (santim). ETB 1,234.56 -> 123456. Stored as bigint.
 *  - Timestamps are unix milliseconds (UTC) as bigint. Display tz is per user.
 *  - Every user-owned row carries user_id so a second user is just an allowlist entry.
 *  - Account numbers are only ever stored masked ("****4321").
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const birr = pgSchema('birr');

const bytea = customType<{ data: Buffer; driverData: Uint8Array | Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (v) => Buffer.from(v),
});

const ms = (name: string) => bigint(name, { mode: 'number' });
const money = (name: string) => bigint(name, { mode: 'number' });
const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const createdAt = () =>
  ms('created_at')
    .notNull()
    .default(sql`(extract(epoch from now()) * 1000)::bigint`);
const userId = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

const CHANNELS = ['bot', 'webhook', 'import', 'manual', 'llm'] as const;

export const users = birr
  .table('users', {
    id: id(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    firstName: text('first_name'),
    locale: text('locale', { enum: ['en', 'am'] }).notNull().default('en'),
    calendarMode: text('calendar_mode', { enum: ['gregorian', 'ethiopian'] }).notNull().default('gregorian'),
    timezone: text('timezone').notNull().default('Africa/Addis_Ababa'),
    digestTime: text('digest_time').notNull().default('21:00'),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    largeTxThreshold: money('large_tx_threshold').notNull().default(500_000),
    lowBalanceThreshold: money('low_balance_threshold').notNull().default(50_000),
    /** keyed hash of the current webhook ingest secret; previous one kept during rotation grace. */
    ingestSecretHash: text('ingest_secret_hash'),
    ingestSecretPrevHash: text('ingest_secret_prev_hash'),
    ingestSecretRotatedAt: ms('ingest_secret_rotated_at'),
    createdAt: createdAt(),
  })
  .enableRLS();

export const accounts = birr
  .table(
    'accounts',
    {
      id: id(),
      userId: userId(),
      type: text('type', { enum: ['telebirr', 'cbe', 'cash', 'other'] }).notNull(),
      name: text('name').notNull(),
      maskedId: text('masked_id'),
      currency: text('currency').notNull().default('ETB'),
      /** Last balance reported by an SMS (or computed for cash). */
      balance: money('balance').notNull().default(0),
      balanceAt: ms('balance_at'),
      archived: boolean('archived').notNull().default(false),
      createdAt: createdAt(),
    },
    (t) => [uniqueIndex('accounts_user_type_mask').on(t.userId, t.type, t.maskedId)],
  )
  .enableRLS();

export const categories = birr
  .table(
    'categories',
    {
      id: id(),
      userId: userId(),
      key: text('key').notNull(),
      name: text('name').notNull(),
      nameAm: text('name_am'),
      icon: text('icon'),
      color: text('color'),
      isSpending: boolean('is_spending').notNull().default(true),
      archived: boolean('archived').notNull().default(false),
      sort: integer('sort').notNull().default(0),
    },
    (t) => [uniqueIndex('categories_user_key').on(t.userId, t.key)],
  )
  .enableRLS();

export const people = birr
  .table(
    'people',
    {
      id: id(),
      userId: userId(),
      displayName: text('display_name').notNull(),
      maskedId: text('masked_id'),
      /** Other spellings seen in SMS. */
      aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
      createdAt: createdAt(),
    },
    (t) => [index('people_user_name').on(t.userId, t.displayName)],
  )
  .enableRLS();

export const rawMessages = birr
  .table(
    'raw_messages',
    {
      id: id(),
      userId: userId(),
      channel: text('channel', { enum: CHANNELS }).notNull(),
      sender: text('sender').notNull(),
      /** AES-256-GCM encrypted SMS body. */
      bodyEnc: bytea('body_enc').notNull(),
      /** Keyed hash used for dedupe. */
      dedupeKey: text('dedupe_key').notNull(),
      receivedAt: ms('received_at').notNull(),
      status: text('status', { enum: ['parsed', 'review', 'ignored', 'resolved'] }).notNull(),
      template: text('template'),
      confidence: doublePrecision('confidence'),
      parseError: text('parse_error'),
      /** Best-effort parse (never the raw text) for low-confidence items, to prefill the review form. */
      candidate: jsonb('candidate').$type<Record<string, unknown>>(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('raw_messages_user_dedupe').on(t.userId, t.dedupeKey),
      index('raw_messages_user_status').on(t.userId, t.status),
    ],
  )
  .enableRLS();

export const transactions = birr
  .table(
    'transactions',
    {
      id: id(),
      userId: userId(),
      accountId: integer('account_id')
        .notNull()
        .references(() => accounts.id),
      rawMessageId: integer('raw_message_id').references(() => rawMessages.id, { onDelete: 'set null' }),
      channel: text('channel', { enum: CHANNELS }).notNull(),
      source: text('source').notNull(),
      direction: text('direction', { enum: ['in', 'out'] }).notNull(),
      kind: text('kind').notNull(),
      amount: money('amount').notNull(),
      fee: money('fee').notNull().default(0),
      vat: money('vat').notNull().default(0),
      otherCharges: money('other_charges').notNull().default(0),
      balanceAfter: money('balance_after'),
      counterpartyName: text('counterparty_name'),
      counterpartyMaskedId: text('counterparty_masked_id'),
      personId: integer('person_id').references(() => people.id, { onDelete: 'set null' }),
      reference: text('reference'),
      receiptUrl: text('receipt_url'),
      occurredAt: ms('occurred_at').notNull(),
      /** true when occurred_at came from the SMS received time, not the message text. */
      occurredAtEstimated: boolean('occurred_at_estimated').notNull().default(false),
      categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
      note: text('note'),
      tags: jsonb('tags').$type<string[]>().notNull().default([]),
      /** Links the two legs of a move between my own accounts. */
      transferGroupId: text('transfer_group_id'),
      /** 'ok' | 'gap' (possible missing SMS before this one) | 'unknown' (no balance info). */
      reconciliation: text('reconciliation', { enum: ['ok', 'gap', 'unknown'] }).notNull().default('unknown'),
      reconciliationDelta: money('reconciliation_delta'),
      confidence: doublePrecision('confidence').notNull().default(1),
      /** Set when I tap OK on the confirmation card (or edit it), i.e. a human has looked at it. */
      confirmedAt: ms('confirmed_at'),
      deletedAt: ms('deleted_at'),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('transactions_user_source_ref').on(t.userId, t.source, t.reference),
      index('transactions_user_time').on(t.userId, t.occurredAt),
      index('transactions_account_time').on(t.accountId, t.occurredAt),
      index('transactions_user_category').on(t.userId, t.categoryId),
      index('transactions_transfer_group').on(t.transferGroupId),
    ],
  )
  .enableRLS();

export const transactionSplits = birr
  .table('transaction_splits', {
    id: id(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    amount: money('amount').notNull(),
    note: text('note'),
  })
  .enableRLS();

export const rules = birr
  .table(
    'rules',
    {
      id: id(),
      userId: userId(),
      field: text('field', { enum: ['counterparty_name', 'counterparty_masked_id', 'kind', 'text'] }).notNull(),
      /** Exact (case-insensitive) value for name/id/kind; substring for 'text'. */
      pattern: text('pattern').notNull(),
      categoryId: integer('category_id')
        .notNull()
        .references(() => categories.id, { onDelete: 'cascade' }),
      priority: integer('priority').notNull().default(100),
      createdAt: createdAt(),
    },
    (t) => [uniqueIndex('rules_user_field_pattern').on(t.userId, t.field, t.pattern)],
  )
  .enableRLS();

export const budgets = birr
  .table(
    'budgets',
    {
      id: id(),
      userId: userId(),
      categoryId: integer('category_id')
        .notNull()
        .references(() => categories.id, { onDelete: 'cascade' }),
      amount: money('amount').notNull(),
      /** Period key of the last alert sent, e.g. "2026-11" or "eth-2019-03". */
      alert80Period: text('alert80_period'),
      alert100Period: text('alert100_period'),
      createdAt: createdAt(),
    },
    (t) => [uniqueIndex('budgets_user_category').on(t.userId, t.categoryId)],
  )
  .enableRLS();

export const goals = birr
  .table('goals', {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    emoji: text('emoji'),
    target: money('target').notNull(),
    saved: money('saved').notNull().default(0),
    deadline: ms('deadline'),
    achievedAt: ms('achieved_at'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  })
  .enableRLS();

export const debts = birr
  .table('debts', {
    id: id(),
    userId: userId(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** lent: they owe me. borrowed: I owe them. */
    direction: text('direction', { enum: ['lent', 'borrowed'] }).notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    dueAt: ms('due_at'),
    originTransactionId: integer('origin_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    settledTransactionId: integer('settled_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    settledAt: ms('settled_at'),
    createdAt: createdAt(),
  })
  .enableRLS();

export const recurringItems = birr
  .table('recurring_items', {
    id: id(),
    userId: userId(),
    label: text('label').notNull(),
    /** What groups the payments: counterparty masked id/name or kind. */
    matchKey: text('match_key').notNull(),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    avgAmount: money('avg_amount').notNull(),
    intervalDays: integer('interval_days').notNull(),
    lastSeenAt: ms('last_seen_at').notNull(),
    nextExpectedAt: ms('next_expected_at').notNull(),
    status: text('status', { enum: ['detected', 'confirmed', 'dismissed'] }).notNull().default('detected'),
    createdAt: createdAt(),
  })
  .enableRLS();

export const achievements = birr
  .table(
    'achievements',
    {
      id: id(),
      userId: userId(),
      key: text('key').notNull(),
      /** Disambiguates repeatable badges, e.g. "2026-11". */
      period: text('period').notNull().default(''),
      data: jsonb('data').$type<Record<string, unknown>>(),
      earnedAt: ms('earned_at').notNull(),
    },
    (t) => [uniqueIndex('achievements_user_key_period').on(t.userId, t.key, t.period)],
  )
  .enableRLS();

/** Reversible actions for /undo. */
export const actionLog = birr
  .table(
    'action_log',
    {
      id: id(),
      userId: userId(),
      action: text('action').notNull(),
      payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
      undoneAt: ms('undone_at'),
      createdAt: createdAt(),
    },
    (t) => [index('action_log_user_time').on(t.userId, t.createdAt)],
  )
  .enableRLS();

/**
 * A bulk import between "preview" and "import": the relevant SMS from the uploaded file,
 * encrypted like raw messages, plus the preview counts. Expires after an hour.
 */
export const imports = birr
  .table(
    'imports',
    {
      id: id(),
      userId: userId(),
      fileName: text('file_name').notNull(),
      format: text('format', { enum: ['xml', 'csv', 'txt'] }).notNull(),
      /** AES-256-GCM encrypted JSON array of { body, sender, receivedAt }. Emptied after commit/cancel. */
      entriesEnc: bytea('entries_enc'),
      summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
      status: text('status', { enum: ['pending', 'committed', 'cancelled'] }).notNull().default('pending'),
      expiresAt: ms('expires_at').notNull(),
      createdAt: createdAt(),
    },
    (t) => [index('imports_user_status').on(t.userId, t.status)],
  )
  .enableRLS();

/** Per-user conversational state for the bot (e.g. "waiting for the new amount"). Serverless-safe. */
export const botState = birr
  .table('bot_state', {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    pending: jsonb('pending').$type<Record<string, unknown>>(),
    expiresAt: ms('expires_at'),
  })
  .enableRLS();

/** Fixed-window rate-limit counters shared by all serverless instances. */
export const rateLimits = birr
  .table('rate_limits', {
    key: text('key').primaryKey(),
    windowStart: ms('window_start').notNull(),
    count: integer('count').notNull(),
  })
  .enableRLS();
