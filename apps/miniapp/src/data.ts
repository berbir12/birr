import type {
  AccountDto,
  CategoryDto,
  ImportSummaryDto,
  ReviewItem,
  ReviewResolveBody,
  RuleDto,
  SettingsDto,
  SettingsPatch,
  SummaryDto,
  TxDetail,
  TxFilters,
  TxPage,
  TxPatch,
  TxPatchResult,
} from '@birr/shared';
import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, patch, post, qs } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && !(e && 'status' in e && [401, 403, 404].includes((e as { status: number }).status)) },
  },
});

export const keys = {
  summary: ['summary'] as const,
  txs: (f: TxFilters) => ['txs', f] as const,
  tx: (id: number) => ['tx', id] as const,
  categories: ['categories'] as const,
  accounts: ['accounts'] as const,
  review: ['review'] as const,
  settings: ['settings'] as const,
  rules: ['rules'] as const,
};

/** Anything that changes a transaction can change totals, lists and the review count. */
function invalidateMoney(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.summary });
  void qc.invalidateQueries({ queryKey: ['txs'] });
  void qc.invalidateQueries({ queryKey: ['tx'] });
}

export const useSummary = () => useQuery({ queryKey: keys.summary, queryFn: () => api<SummaryDto>('/summary') });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api<CategoryDto[]>('/categories'), staleTime: 5 * 60_000 });
export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: () => api<AccountDto[]>('/accounts') });
export const useTx = (id: number) => useQuery({ queryKey: keys.tx(id), queryFn: () => api<TxDetail>(`/transactions/${id}`) });
export const useReview = () => useQuery({ queryKey: keys.review, queryFn: () => api<ReviewItem[]>('/review') });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsDto>('/settings') });
export const useRules = () => useQuery({ queryKey: keys.rules, queryFn: () => api<RuleDto[]>('/rules') });

export function useTransactions(f: TxFilters) {
  return useInfiniteQuery({
    queryKey: keys.txs(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<TxPage>(`/transactions${qs({ ...f, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function usePatchTx(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: TxPatch) => patch<TxPatchResult>(`/transactions/${id}`, p),
    onSuccess: (r) => {
      qc.setQueryData(keys.tx(id), r.tx);
      invalidateMoney(qc);
    },
  });
}

export function useCreateRule(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) => post<{ updated: number }>(`/transactions/${id}/rule`, { categoryId }),
    onSuccess: () => {
      invalidateMoney(qc);
      void qc.invalidateQueries({ queryKey: keys.rules });
    },
  });
}

export function useDeleteTx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del<{ deleted: boolean }>(`/transactions/${id}`),
    onSuccess: () => invalidateMoney(qc),
  });
}

export function useRestoreTx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post<{ restored: boolean }>(`/transactions/${id}/restore`),
    onSuccess: () => invalidateMoney(qc),
  });
}

export function useUnlinkTransfer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post(`/transactions/${id}/unlink-transfer`),
    onSuccess: () => invalidateMoney(qc),
  });
}

export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ReviewResolveBody }) => post<{ txId: number }>(`/review/${id}/resolve`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.review });
      invalidateMoney(qc);
    },
  });
}

export function useDismissReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/review/${id}/dismiss`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.review });
      void qc.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useRetryReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ created: number; stillInReview: number }>('/review/retry'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.review });
      invalidateMoney(qc);
    },
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: SettingsPatch) => patch<SettingsDto>('/settings', p),
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  });
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.categories });
    invalidateMoney(qc);
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; icon?: string | null }) => post<CategoryDto>('/categories', b), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: number } & Partial<Pick<CategoryDto, 'name' | 'icon' | 'archived'>>) => patch<CategoryDto>(`/categories/${id}`, b),
      onSuccess: done,
    }),
  };
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => del(`/rules/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.rules }) });
}

export interface ImportResult {
  counts: { created: number; duplicates: number; review: number };
  gaps: number;
  linked: number;
}
export const importApi = {
  preview: (body: { fileName: string; format: 'xml' | 'csv' | 'txt'; inFile: number; entries: Array<{ sender: string | null; body: string; receivedAt: number | null }> }) =>
    post<{ importId: number; summary: ImportSummaryDto }>('/import/preview', body),
  commit: (id: number) => post<ImportResult>(`/import/${id}/commit`),
  cancel: (id: number) => post(`/import/${id}/cancel`),
};

// ---------------------------------------------------------------- Phase 6

import type { AnalyticsDto, AnalyticsRange, BudgetsDto, DebtDto, GoalDto, PersonDetailDto, PersonDto, RecurringDto, TxListItem } from '@birr/shared';

export const planKeys = {
  analytics: (r: AnalyticsRange) => ['analytics', r] as const,
  budgets: ['budgets'] as const,
  goals: ['goals'] as const,
  people: ['people'] as const,
  person: (id: number) => ['person', id] as const,
  recurring: ['recurring'] as const,
};

export const useAnalytics = (r: AnalyticsRange) => useQuery({ queryKey: planKeys.analytics(r), queryFn: () => api<AnalyticsDto>(`/analytics?range=${r}`) });
export const useBudgets = () => useQuery({ queryKey: planKeys.budgets, queryFn: () => api<BudgetsDto>('/budgets') });
export const useGoals = () => useQuery({ queryKey: planKeys.goals, queryFn: () => api<GoalDto[]>('/goals') });
export const usePeople = () => useQuery({ queryKey: planKeys.people, queryFn: () => api<PersonDto[]>('/people') });
export const usePerson = (id: number) => useQuery({ queryKey: planKeys.person(id), queryFn: () => api<PersonDetailDto>(`/people/${id}`) });
export const useRecurring = () => useQuery({ queryKey: planKeys.recurring, queryFn: () => api<{ items: RecurringDto[]; monthlyTotal: number }>('/recurring') });
export const debtCandidates = (id: number) => api<TxListItem[]>(`/debts/${id}/candidates`);

export function usePlanMutation<V, R = unknown>(fn: (v: V) => Promise<R>, invalidate: ReadonlyArray<readonly unknown[]>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export const planApi = {
  setBudget: (v: { categoryId: number; amount: number }) => api<BudgetsDto>(`/budgets/${v.categoryId}`, { method: 'PUT', json: { amount: v.amount } }),
  deleteBudget: (categoryId: number) => del<BudgetsDto>(`/budgets/${categoryId}`),
  createGoal: (v: { name: string; emoji?: string | null; target: number; deadline?: number | null }) => post<GoalDto>('/goals', v),
  contribute: (v: { id: number; amount: number }) => post<GoalDto>(`/goals/${v.id}/contribute`, { amount: v.amount }),
  archiveGoal: (id: number) => patch<GoalDto>(`/goals/${id}`, { archived: true }),
  createDebt: (v: { personId?: number; personName?: string; direction: 'lent' | 'borrowed'; amount: number; note?: string | null }) => post<DebtDto>('/debts', v),
  settleDebt: (v: { id: number; transactionId: number | null }) => post(`/debts/${v.id}/settle`, { transactionId: v.transactionId }),
  reopenDebt: (id: number) => post(`/debts/${id}/reopen`),
  deleteDebt: (id: number) => del(`/debts/${id}`),
  recurring: (v: { id: number; action: 'confirm' | 'dismiss' }) => post(`/recurring/${v.id}/${v.action}`),
};
