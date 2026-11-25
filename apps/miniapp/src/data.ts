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
