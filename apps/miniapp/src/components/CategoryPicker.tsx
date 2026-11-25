import { useCategories } from '../data';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { Sheet, Spinner } from '../ui';

export function CategoryPicker({
  open,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  current: number | null;
  onPick: (categoryId: number) => void;
  onClose: () => void;
}) {
  const cats = useCategories();
  return (
    <Sheet open={open} onClose={onClose} title={t('detail.category')}>
      {cats.isLoading && <Spinner />}
      <div className="grid grid-cols-3 gap-2">
        {cats.data
          ?.filter((c) => !c.archived)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => {
                haptic.select();
                onPick(c.id);
              }}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center text-[13px] leading-tight ${
                c.id === current ? 'bg-accent text-accent-text' : 'bg-section'
              }`}
            >
              <span className="text-2xl">{c.icon ?? '📦'}</span>
              <span>{c.name}</span>
            </button>
          ))}
      </div>
    </Sheet>
  );
}
