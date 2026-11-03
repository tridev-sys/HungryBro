import { formatINR } from '@/lib/ui/format';
import type { MenuCard } from '@/lib/menu/filters';

export interface MenuListProps {
  items: MenuCard[];
  onAdd: (item: MenuCard) => void;
  busy?: boolean;
}

const DIET_LABEL: Record<string, string> = {
  pure_veg: 'Veg', jain: 'Jain', halal: 'Halal', non_veg: 'Non-veg', vegan: 'Vegan', egg: 'Egg',
};

export function MenuList({ items, onAdd, busy = false }: MenuListProps) {
  if (items.length === 0) {
    return <p className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-sm">No dishes match these filters.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Menu">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.name}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {DIET_LABEL[item.dietary] ?? item.dietary} · spice {item.spiceLevel}
              {item.allergens.length > 0 ? ` · contains ${item.allergens.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm tabular-nums">{formatINR(item.price)}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAdd(item)}
              className="min-h-[44px] min-w-[44px] rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-accent-ink)] disabled:opacity-50"
            >
              Add {item.name}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
