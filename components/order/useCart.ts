'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  addOne, emptyCart, readStoredCart, removeOne, writeStoredCart, type Cart, type CartItemInput,
} from '@/lib/delivery-customer/cart';

/** The client cart, held in localStorage. Loaded after mount so server and client markup match. */
export function useCart(restaurantId: string) {
  const [cart, setCart] = useState<Cart>(emptyCart);

  useEffect(() => {
    setCart(readStoredCart(window.localStorage));
  }, []);

  const update = useCallback((fn: (c: Cart) => Cart) => {
    setCart((prev) => {
      const next = fn(prev);
      writeStoredCart(window.localStorage, next);
      return next;
    });
  }, []);

  return {
    cart,
    add: (item: CartItemInput) => update((c) => addOne(c, restaurantId, item)),
    remove: (menuItemId: string) => update((c) => removeOne(c, menuItemId)),
  };
}
