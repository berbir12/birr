/**
 * Birr data model (SQLite via Drizzle).
 *
 * Conventions:
 *  - Money is integer cents (santim). ETB 1,234.56 -> 123456.
 *  - Timestamps are integer unix milliseconds (UTC). Display tz is per user.
 *  - Every user-owned row carries user_id so a second user is just an allowlist entry.
 *  - Account numbers are only ever stored masked ("****4321").
 */
import { sql } from 'drizzle-orm';
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const userId = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const users = sqliteTable('users', {
  id: id(),
  telegramId: integer('telegram_id').notNull().unique(),
  firstName: text('first_name'),
  locale: text('locale', { enum: ['en', 'am'] }).notNull().default('en'),
  calendarMode: text('calendar_mode', { enum: ['gregorian', 'ethiopian'] }).notNull().default('gregorian'),
  timezone: text('timezone').notNull().default('Africa/Addis_Ababa'),
  digestTime: text('digest_time').notNull().default('21:00'),
  digestEnabled: integer('digest_enabled', { mode: 'boolean' }).notNull().default(true),
  largeTxThreshold: integer('large_tx_threshold').notNull().default(500_000),
  lowBalanceThreshold: integer('low_balance_threshold').notNull().default(50_000),
  /** keyed hash of the current webhook ingest secret; previous one kept during rotation grace. */
  ingestSecretHash: text('ingest_secret_hash'),
  ingestSecretPrevHash: text('ingest_secret_prev_hash'),
  ingestSecretRotatedAt: integer('ingest_secret_rotated_at'),
  createdAt: createdAt(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    userId: userId(),
    type: text('type', { enum: ['telebirr', 'cbe', 'cash', 'other'] }).notNull(),
    name: text('name').notNull(),
    maskedId: text('masked_id'),
    currency: text('currency').notNull().default('ETB'),
    /** Last balance reported by an SMS (or computed for cash). */
    balance: integer('balance').notNull().default(0),
    balanceAt: integer('balance_at'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('accounts_user_type_mask').on(t.userId, t.type, t.maskedId)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    userId: userId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    nameAm: text('name_am'),
    icon: text('icon'),
    color: text('color'),
    isSpending: integer('is_spending', { mode: 'boolean' }).notNull().default(true),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_user_key').on(t.userId, t.key)],
);

export const people = sqliteTable(
  'people',
  {
    id: id(),
    userId: userId(),
    displayName: text('display_name').notNull(),
    maskedId: text('masked_id'),
    /** Other spellings seen in SMS, JSON string[]. */
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: createdAt(),
  },
  (t) => [index('people_user_name').on(t.userId, t.displayName)],
);

export const rawMessages = sqliteTable(
  'raw_messages',
  {
    id: id(),
    userId: userId(),
    channel: text('channel', { enum: ['bot', 'webhook', 'import', 'manual', 'llm'] }).notNull(),
    sender: text('sender').notNull(),
    /** AES-256-GCM encrypted SMS body. */
    bodyEnc: blob('body_enc', { mode: 'buffer' }).notNull(),
    /** Keyed hash used for dedupe when no transaction reference exists. */
    dedupeKey: text('dedupe_key').notNull(),
    receivedAt: integer('received_at').notNull(),
    status: text('status', { enum: ['parsed', 'review', 'ignored', 'resolved'] }).notNull(),
    template: text('template'),
    confidence: real('confidence'),
    parseError: text('parse_error'),
    /** Best-effort parse (never the raw text) for low-confidence items, to prefill the review form. */
    candidate: text('candidate', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('raw_messages_user_dedupe').on(t.userId, t.dedupeKey),
    index('raw_messages_user_status').on(t.userId, t.status),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    userId: userId(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    rawMessageId: integer('raw_message_id').references(() => rawMessages.id, { onDelete: 'set null' }),
    channel: text('channel', { enum: ['bot', 'webhook', 'import', 'manual', 'llm'] }).notNull(),
    source: text('source').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    kind: text('kind').notNull(),
    amount: integer('amount').notNull(),
    fee: integer('fee').notNull().default(0),
    vat: integer('vat').notNull().default(0),
    otherCharges: integer('other_charges').notNull().default(0),
    balanceAfter: integer('balance_after'),
    counterpartyName: text('counterparty_name'),
    counterpartyMaskedId: text('counterparty_masked_id'),
    personId: integer('person_id').references(() => people.id, { onDelete: 'set null' }),
    reference: text('reference'),
    receiptUrl: text('receipt_url'),
    occurredAt: integer('occurred_at').notNull(),
    /** true when occurred_at came from SMS received time, not the message text. */
    occurredAtEstimated: integer('occurred_at_estimated', { mode: 'boolean' }).notNull().default(false),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    note: text('note'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Links the two legs of a move between my own accounts. */
    transferGroupId: text('transfer_group_id'),
    /** 'ok' | 'gap' (possible missing SMS before this one) | 'unknown' (no balance info). */
    reconciliation: text('reconciliation', { enum: ['ok', 'gap', 'unknown'] }).notNull().default('unknown'),
    reconciliationDelta: integer('reconciliation_delta'),
    confidence: real('confidence').notNull().default(1),
    /** Set when I tap OK on the confirmation card (or edit it), i.e. a human has looked at it. */
    confirmedAt: integer('confirmed_at'),
    deletedAt: integer('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('transactions_user_source_ref').on(t.userId, t.source, t.reference),
    index('transactions_user_time').on(t.userId, t.occurredAt),
    index('transactions_account_time').on(t.accountId, t.occurredAt),
    index('transactions_user_category').on(t.userId, t.categoryId),
    index('transactions_transfer_group').on(t.transferGroupId),
  ],
);

export const transactionSplits = sqliteTable('transaction_splits', {
  id: id(),
  transactionId: integer('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  amount: integer('amount').notNull(),
  note: text('note'),
});

export const rules = sqliteTable(
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
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: id(),
    userId: userId(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    /** Period key of the last alert sent, e.g. "2026-11" or "eth-2019-03". */
    alert80Period: text('alert80_period'),
    alert100Period: text('alert100_period'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budgets_user_category').on(t.userId, t.categoryId)],
);

export const goals = sqliteTable('goals', {
  id: id(),
  userId: userId(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  target: integer('target').notNull(),
  saved: integer('saved').notNull().default(0),
  deadline: integer('deadline'),
  achievedAt: integer('achieved_at'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

export const debts = sqliteTable('debts', {
  id: id(),
  userId: userId(),
  personId: integer('person_id')
    .notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  /** lent: they owe me. borrowed: I owe them. */
  direction: text('direction', { enum: ['lent', 'borrowed'] }).notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
  dueAt: integer('due_at'),
  originTransactionId: integer('origin_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  settledTransactionId: integer('settled_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  settledAt: integer('settled_at'),
  createdAt: createdAt(),
});

export const recurringItems = sqliteTable('recurring_items', {
  id: id(),
  userId: userId(),
  label: text('label').notNull(),
  /** What groups the payments: counterparty masked id/name or kind. */
  matchKey: text('match_key').notNull(),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  avgAmount: integer('avg_amount').notNull(),
  intervalDays: integer('interval_days').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  nextExpectedAt: integer('next_expected_at').notNull(),
  status: text('status', { enum: ['detected', 'confirmed', 'dismissed'] }).notNull().default('detected'),
  createdAt: createdAt(),
});

export const achievements = sqliteTable(
  'achievements',
  {
    id: id(),
    userId: userId(),
    key: text('key').notNull(),
    /** Disambiguates repeatable badges, e.g. "2026-11". */
    period: text('period').notNull().default(''),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    earnedAt: integer('earned_at').notNull(),
  },
  (t) => [uniqueIndex('achievements_user_key_period').on(t.userId, t.key, t.period)],
);

/** Reversible actions for /undo. */
export const actionLog = sqliteTable(
  'action_log',
  {
    id: id(),
    userId: userId(),
    action: text('action').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    undoneAt: integer('undone_at'),
    createdAt: createdAt(),
  },
  (t) => [index('action_log_user_time').on(t.userId, t.createdAt)],
);
