import { useCategories } from '../data';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { CategoryIcon } from '../theme';
import { Sheet, Spinner } from '../ui';

export function CategoryPicker({
  open,
  current,
  onPick,
  onClose,
  title = t('detail.category'),
  exclude = [],
}: {
  open: boolean;
  current: number | null;
  onPick: (categoryId: number) => void;
  onClose: () => void;
  title?: string;
  exclude?: readonly string[];
}) {
  const cats = useCategories();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {cats.isLoading && <Spinner />}
      <div className="grid grid-cols-3 gap-2.5">
        {cats.data
          ?.filter((c) => !c.archived && !exclude.includes(c.key))
          .map((c) => (
            <button
              key={c.id}
              onClick={() => {
                haptic.select();
                onPick(c.id);
              }}
              className={`card flex flex-col items-center gap-2 px-2 py-3.5 text-center text-[13px] font-medium leading-tight transition active:scale-95 ${
                c.id === current ? 'ring-2 ring-accent' : ''
              }`}
            >
              <CategoryIcon categoryKey={c.key} emoji={c.icon} size={40} />
              <span>{c.name}</span>
            </button>
          ))}
      </div>
    </Sheet>
  );
}
