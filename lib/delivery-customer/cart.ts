// Client-held cart. The browser stores only menu item ids and quantities for display. Prices shown
// here are for the diner's view; the server recomputes every price from the database at checkout.
import { z } from 'zod';
import { round2 } from '@/lib/pricing';

export const CART_STORAGE_KEY = 'fos-cart-v1';
export const MAX_LINE_QUANTITY = 20;

export interface CartItemInput {
  id: string;
  name: string;
  priceInr: number;
}

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPriceInr: number;
  quantity: number;
}

export interface Cart {
  restaurantId: string | null;
  lines: CartLine[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const StoredCart = z.object({
  restaurantId: z.string().nullable(),
  lines: z.array(z.object({
    menuItemId: z.string().min(1),
    name: z.string(),
    unitPriceInr: z.number().nonnegative(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })).max(30),
});

export function emptyCart(): Cart {
  return { restaurantId: null, lines: [] };
}

/** Adds one unit. A cart holds one restaurant, so a different restaurant starts a new cart. */
export function addOne(cart: Cart, restaurantId: string, item: CartItemInput): Cart {
  const base = cart.restaurantId === restaurantId ? cart : emptyCart();
  const existing = base.lines.find((l) => l.menuItemId === item.id);
  if (existing) {
    if (existing.quantity >= MAX_LINE_QUANTITY) return { ...base, restaurantId };
    return {
      restaurantId,
      lines: base.lines.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)),
    };
  }
  return {
    restaurantId,
    lines: [...base.lines, { menuItemId: item.id, name: item.name, unitPriceInr: item.priceInr, quantity: 1 }],
  };
}

/** Removes one unit; the line disappears at zero. */
export function removeOne(cart: Cart, menuItemId: string): Cart {
  const lines = cart.lines
    .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity - 1 } : l))
    .filter((l) => l.quantity > 0);
  return { ...cart, lines };
}

export function quantityOf(cart: Cart, menuItemId: string): number {
  return cart.lines.find((l) => l.menuItemId === menuItemId)?.quantity ?? 0;
}

export function cartSubtotal(cart: Cart): number {
  return round2(cart.lines.reduce((sum, l) => sum + l.unitPriceInr * l.quantity, 0));
}

export function readStoredCart(storage: KeyValueStorage): Cart {
  const raw = storage.getItem(CART_STORAGE_KEY);
  if (!raw) return emptyCart();
  try {
    const parsed = StoredCart.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyCart();
  } catch {
    return emptyCart();
  }
}

export function writeStoredCart(storage: KeyValueStorage, cart: Cart): void {
  storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}
