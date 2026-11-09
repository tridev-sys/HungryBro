'use client';
import { formatINR } from '@/lib/ui/format';
import { cartSubtotal, quantityOf, MAX_LINE_QUANTITY } from '@/lib/delivery-customer/cart';
import type { MenuCategoryView, MenuItemView } from '@/lib/delivery-customer/menu';
import { useCart } from './useCart';

const DIETARY_LABEL: Record<string, string> = {
  pure_veg: 'Pure veg',
  jain: 'Jain',
  halal: 'Halal',
  non_veg: 'Non-veg',
  vegan: 'Vegan',
  egg: 'Egg',
};

export function MenuList({
  restaurantId,
  restaurantName,
  categories,
}: {
  restaurantId: string;
  restaurantName: string;
  categories: MenuCategoryView[];
}) {
  const { cart, add, remove } = useCart(restaurantId);
  return (
    <div>
      <h1 className="text-2xl font-semibold">{restaurantName}</h1>
      {categories.map((group) => (
        <section key={group.name} className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">{group.name}</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {group.items.map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                quantity={quantityOf(cart, item.id)}
                onAdd={() => add({ id: item.id, name: item.name, priceInr: item.priceInr })}
                onRemove={() => remove(item.id)}
              />
            ))}
          </ul>
        </section>
      ))}
      <footer className="sticky bottom-0 mt-8 flex items-center justify-between rounded-card bg-surface-2 p-4">
        <span className="text-text-muted">Subtotal</span>
        <span data-testid="cart-subtotal" className="font-semibold">{formatINR(cartSubtotal(cart))}</span>
      </footer>
    </div>
  );
}

function MenuRow({
  item,
  quantity,
  onAdd,
  onRemove,
}: {
  item: MenuItemView;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-card bg-surface p-4">
      <div className="min-w-0">
        <p className="font-medium">{item.name}</p>
        {item.description ? <p className="text-sm text-text-muted">{item.description}</p> : null}
        <p className="mt-1 text-sm">{formatINR(item.priceInr)}</p>
        <p className="text-xs text-text-muted">{DIETARY_LABEL[item.dietary] ?? item.dietary}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2" role="group" aria-label={`Quantity controls for ${item.name}`}>
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          disabled={quantity === 0}
          onClick={onRemove}
          className="h-10 w-10 rounded-pill bg-surface-2 disabled:opacity-40"
        >
          −
        </button>
        <span aria-label={`Quantity of ${item.name}`} className="w-6 text-center">{quantity}</span>
        <button
          type="button"
          aria-label={`Add ${item.name}`}
          disabled={quantity >= MAX_LINE_QUANTITY}
          onClick={onAdd}
          className="h-10 w-10 rounded-pill bg-accent text-accent-ink disabled:opacity-40"
        >
          +
        </button>
      </div>
    </li>
  );
}
