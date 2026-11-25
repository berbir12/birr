import type { TxPatchResult } from '@birr/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { patch, post } from '../api';
import { keys } from '../data';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { Button, Sheet, useToast } from '../ui';
import { CategoryPicker } from './CategoryPicker';

/**
 * Category change with the "Always categorize X as Y?" follow-up, shared by the list (swipe)
 * and the detail screen.
 */
export function useRecategorize() {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<{ id: number; categoryId: number | null } | null>(null);
  const [prompt, setPrompt] = useState<{ id: number; p: NonNullable<TxPatchResult['rulePrompt']> } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.summary });
    void qc.invalidateQueries({ queryKey: ['txs'] });
    void qc.invalidateQueries({ queryKey: ['tx'] });
  };

  const pick = async (categoryId: number) => {
    const id = target!.id;
    setTarget(null);
    try {
      const r = await patch<TxPatchResult>(`/transactions/${id}`, { categoryId });
      qc.setQueryData(keys.tx(id), r.tx);
      refresh();
      haptic.success();
      if (r.rulePrompt) setPrompt({ id, p: r.rulePrompt });
    } catch {
      haptic.error();
      toast(t('common.error'));
    }
  };

  const saveRule = async () => {
    const pr = prompt!;
    setPrompt(null);
    const r = await post<{ updated: number }>(`/transactions/${pr.id}/rule`, { categoryId: pr.p.categoryId });
    refresh();
    void qc.invalidateQueries({ queryKey: keys.rules });
    toast(r.updated ? `${t('detail.rule.saved')} · ${r.updated} updated` : t('detail.rule.saved'));
  };

  const element = (
    <>
      <CategoryPicker open={target !== null} current={target?.categoryId ?? null} onPick={pick} onClose={() => setTarget(null)} />
      <Sheet open={prompt !== null} onClose={() => setPrompt(null)}>
        {prompt && (
          <div className="px-2 pb-2 text-center">
            <p className="mb-4 mt-1 text-[17px]">{t('detail.rule', { counterparty: prompt.p.counterparty, category: prompt.p.categoryName })}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button kind="secondary" onClick={() => setPrompt(null)}>
                {t('detail.rule.no')}
              </Button>
              <Button onClick={saveRule}>{t('detail.rule.yes')}</Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );

  return { open: (id: number, categoryId: number | null) => setTarget({ id, categoryId }), element };
}
