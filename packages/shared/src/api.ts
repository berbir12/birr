/** Request/response shapes shared by the API (apps/server) and the Mini App (apps/miniapp). */
import type { Cents, Locale, CalendarMode } from './types.js';

export interface AccountDto {
  id: number;
  type: 'telebirr' | 'cbe' | 'cash' | 'other';
  name: string;
  maskedId: string | null;
  balance: Cents;
  balanceAt: number | null;
}

export interface CategoryDto {
  id: number;
  key: string;
  name: string;
  nameAm: string | null;
  icon: string | null;
  isSpending: boolean;
  archived: boolean;
}

export interface TxListItem {
  id: number;
  occurredAt: number;
  occurredAtEstimated: boolean;
  direction: 'in' | 'out';
  kind: string;
  amount: Cents;
  /** fee + VAT + other levies */
  charges: Cents;
  counterparty: string | null;
  categoryId: number | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: number;
  accountName: string;
  internal: boolean;
  reconciliation: 'ok' | 'gap' | 'unknown';
  note: string | null;
  tags: string[];
  confirmed: boolean;
}

export interface TxDetail extends TxListItem {
  fee: Cents;
  vat: Cents;
  otherCharges: Cents;
  balanceAfter: Cents | null;
  counterpartyMaskedId: string | null;
  reference: string | null;
  receiptUrl: string | null;
  reconciliationDelta: Cents | null;
  transferPeerAccount: string | null;
  channel: string;
  deleted: boolean;
}

export interface TxPage {
  items: TxListItem[];
  nextCursor: string | null;
}

export interface TxFilters {
  accountId?: number;
  categoryId?: number;
  personId?: number;
  direction?: 'in' | 'out';
  kind?: string;
  minAmount?: Cents;
  maxAmount?: Cents;
  from?: number;
  to?: number;
  q?: string;
  /** Only transactions after a balance gap (possible missing SMS). */
  reconciliation?: 'gap';
}

export interface SummaryDto {
  month: { key: string; start: number; end: number };
  accounts: AccountDto[];
  total: Cents;
  monthIn: Cents;
  monthOut: Cents;
  monthFees: Cents;
  /** null when no budgets are set. */
  safeToSpendToday: Cents | null;
  insight: { categoryKey: string; categoryName: string; pct: number } | null;
  recent: TxListItem[];
  reviewCount: number;
  gapCount: number;
}

export interface TxPatch {
  categoryId?: number;
  note?: string;
  amount?: Cents;
  counterpartyName?: string;
}

export interface TxPatchResult {
  tx: TxDetail;
  /** Offer "Always categorize X as Y?" after a category change. */
  rulePrompt: { counterparty: string; categoryId: number; categoryName: string } | null;
}

export interface ReviewItem {
  id: number;
  receivedAt: number;
  sender: string;
  channel: string;
  body: string;
  reason: string | null;
  /** Best-effort parse (low-confidence items). */
  candidate: Record<string, unknown> | null;
}

export interface ReviewResolveBody {
  source: 'telebirr' | 'cbe';
  direction: 'in' | 'out';
  kind: string;
  amount: Cents;
  fee?: Cents;
  vat?: Cents;
  otherCharges?: Cents;
  balanceAfter?: Cents | null;
  counterpartyName?: string | null;
  occurredAt: number;
  categoryId?: number | null;
  note?: string | null;
}

export interface SettingsDto {
  locale: Locale;
  calendarMode: CalendarMode;
  timezone: string;
  digestTime: string;
  digestEnabled: boolean;
  largeTxThreshold: Cents;
  lowBalanceThreshold: Cents;
  ingest: { connected: boolean; rotatedAt: number | null; url: string };
}

export type SettingsPatch = Partial<
  Pick<SettingsDto, 'locale' | 'calendarMode' | 'digestTime' | 'digestEnabled' | 'largeTxThreshold' | 'lowBalanceThreshold'>
>;

export interface RuleDto {
  id: number;
  field: string;
  pattern: string;
  categoryId: number;
  categoryName: string;
}

export interface ImportSummaryDto {
  fileName: string;
  format: 'xml' | 'csv' | 'txt';
  inFile: number;
  relevant: number;
  bySource: { telebirr: number; cbe: number };
  created: number;
  duplicates: number;
  review: number;
  from: number | null;
  to: number | null;
}

export interface ImportEntryDto {
  sender: string | null;
  body: string;
  receivedAt: number | null;
}

// ---------------------------------------------------------------- Phase 6

export type AnalyticsRange = 'month' | 'last-month' | '3m' | 'year';

export interface AnalyticsDto {
  range: AnalyticsRange;
  from: number;
  to: number;
  totalOut: Cents;
  totalIn: Cents;
  byCategory: Array<{ categoryKey: string; name: string; icon: string | null; amount: Cents }>;
  /** Last 6 calendar months, oldest first. */
  cashflow: Array<{ key: string; start: number; in: Cents; out: Cents }>;
  /** Spending per local day within the range: "2026-11-24" → cents. */
  daily: Record<string, Cents>;
  topPeople: Array<{ key: string; name: string; personId: number | null; out: Cents; in: Cents; count: number }>;
  fees: { total: Cents; fee: Cents; vat: Cents; other: Cents; bySource: Record<string, Cents>; count: number; yearTotal: Cents };
}

export interface BudgetDto {
  categoryId: number;
  categoryKey: string;
  name: string;
  icon: string | null;
  amount: Cents;
  spent: Cents;
  remaining: Cents;
  pct: number;
  state: 'ok' | 'warning' | 'over';
  projected: Cents | null;
}

export interface BudgetsDto {
  month: { key: string; start: number; end: number; daysLeft: number };
  budgets: BudgetDto[];
  total: { amount: Cents; spent: Cents };
}

export interface GoalDto {
  id: number;
  name: string;
  emoji: string | null;
  target: Cents;
  saved: Cents;
  deadline: number | null;
  achievedAt: number | null;
  pct: number;
  remaining: Cents;
  weeksLeft: number | null;
  suggestedWeekly: Cents | null;
  overdue: boolean;
}

export interface PersonDto {
  id: number;
  name: string;
  maskedId: string | null;
  out: Cents;
  in: Cents;
  count: number;
  lastAt: number | null;
  /** > 0 they owe me, < 0 I owe them. */
  balance: Cents;
}

export interface DebtDto {
  id: number;
  personId: number;
  personName: string;
  direction: 'lent' | 'borrowed';
  amount: Cents;
  note: string | null;
  dueAt: number | null;
  createdAt: number;
  settledAt: number | null;
  settledTransactionId: number | null;
}

export interface PersonDetailDto {
  person: PersonDto;
  debts: DebtDto[];
  recent: TxListItem[];
}

export interface RecurringDto {
  id: number;
  label: string;
  categoryKey: string | null;
  intervalDays: number;
  avgAmount: Cents;
  monthlyAmount: Cents;
  lastSeenAt: number;
  nextExpectedAt: number;
  status: 'detected' | 'confirmed';
}
