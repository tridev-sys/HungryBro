'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatINR } from '@/lib/ui/format';
import { cartSubtotal, emptyCart, quantityOf, readStoredCart, removeOne, writeStoredCart, type Cart } from '@/lib/delivery-customer/cart';

/** The held cart. Totals shown here are the browser's view; checkout re-prices on the server. */
export function CartView() {
  const [cart, setCart] = useState<Cart>(emptyCart);

  useEffect(() => {
    setCart(readStoredCart(window.localStorage));
  }, []);

  const removeLine = (menuItemId: string) => {
    setCart((prev) => {
      const next = removeOne(prev, menuItemId);
      writeStoredCart(window.localStorage, next);
      return next;
    });
  };

  if (cart.lines.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p className="mt-6 text-text-muted">Your cart is empty.</p>
        <Link href="/order" className="mt-4 inline-block text-accent">Browse restaurants</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Your cart</h1>
      <ul className="mt-6 flex flex-col gap-3">
        {cart.lines.map((line) => (
          <li key={line.menuItemId} className="flex items-center justify-between gap-3 rounded-card bg-surface p-4">
            <div>
              <p className="font-medium">{line.name}</p>
              <p className="text-sm text-text-muted">{formatINR(line.unitPriceInr)} each</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">× {quantityOf(cart, line.menuItemId)}</span>
              <button
                type="button"
                aria-label={`Remove one ${line.name}`}
                onClick={() => removeLine(line.menuItemId)}
                className="h-11 w-11 rounded-pill bg-surface-2"
              >
                −
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex justify-between">
        <span className="text-text-muted">Subtotal</span>
        <span className="font-semibold">{formatINR(cartSubtotal(cart))}</span>
      </p>
      <Link
        href="/order/checkout"
        className="mt-6 block rounded-pill bg-accent px-6 py-3 text-center font-semibold text-accent-ink"
      >
        Continue to checkout
      </Link>
    </div>
  );
}
