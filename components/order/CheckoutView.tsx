'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatINR } from '@/lib/ui/format';
import { gstOn } from '@/lib/pricing';
import { CART_STORAGE_KEY, cartSubtotal, emptyCart, readStoredCart, type Cart } from '@/lib/delivery-customer/cart';

const CHECKOUT_KEY = 'fos-checkout-key';

interface Quote { subtotalInr: number; gstInr: number; totalInr: number }

const ERROR_TEXT: Record<string, string> = {
  OUT_OF_STOCK: 'An item in your cart is no longer available. Remove it and try again.',
  UNKNOWN_ITEM: 'An item in your cart is no longer on the menu. Remove it and try again.',
  RESTAURANT_CLOSED: 'This restaurant is not delivering right now.',
  PAYMENT_UNAVAILABLE: 'Payments are not available right now. Please try again shortly.',
  AUCTION_NOT_FOUND: 'We could not link this delivery request. Please try again.',
  DUPLICATE_CHECKOUT: 'This order is already being placed. Please wait a moment.',
  UNAUTHENTICATED: 'Sign in to place an order.',
  'sign-in required': 'Sign in to place an order.',
};

function checkoutKey(): string {
  let key = window.sessionStorage.getItem(CHECKOUT_KEY);
  if (!key) {
    key = crypto.randomUUID().replace(/-/g, '');
    window.sessionStorage.setItem(CHECKOUT_KEY, key);
  }
  return key;
}

function currentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-geolocation'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('no-geolocation')),
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  });
}

export function CheckoutView() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = readStoredCart(window.localStorage);
    setCart(c);
    if (c.lines.length === 0 || !c.restaurantId) return;
    fetch('/api/orders/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restaurantId: c.restaurantId, lines: c.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })) }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (r.ok) setQuote(body as Quote);
        else setError(ERROR_TEXT[body.error] ?? 'Could not price your cart.');
      })
      .catch(() => setError('Could not reach the server. Check your connection.'));
  }, []);

  if (cart.lines.length === 0 || !cart.restaurantId) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <p className="mt-6 text-text-muted">Your cart is empty.</p>
        <Link href="/order" className="mt-4 inline-block text-accent">Browse restaurants</Link>
      </div>
    );
  }

  const restaurantId = cart.restaurantId;
  const estimate = Math.min(100000, Math.max(1, Math.ceil(cartSubtotal(cart) * 1.05 * 100) / 100));

  async function placeOrder() {
    setBusy(true);
    setError(null);
    try {
      let coords: { lat: number; lng: number };
      try {
        coords = await currentLocation();
      } catch {
        setError('Allow location to find delivery options near you.');
        return;
      }
      const intentRes = await fetch('/api/delivery/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript: `Food delivery from ${restaurantId}`,
          intent: {
            modality: 'DELIVERY',
            budget_ceiling_inr: quote ? Math.min(100000, quote.totalInr) : estimate,
            sla_max_minutes: 45,
            headcount: 1,
            target_dietary_profiles: [],
            items_requested: cart.lines.map((l) => ({ query: l.name, serving_target: l.quantity })),
            client_coordinates: coords,
          },
        }),
      });
      const intentBody = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || typeof intentBody.auctionId !== 'string') {
        setError(ERROR_TEXT[intentBody.error] ?? 'We could not start your delivery request. Please try again.');
        return;
      }

      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          lines: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          clientKey: checkoutKey(),
          auctionId: intentBody.auctionId,
        }),
      });
      const orderBody = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok) {
        setError(ERROR_TEXT[orderBody.error] ?? 'Could not place your order. Please try again.');
        return;
      }
      window.localStorage.removeItem(CART_STORAGE_KEY);
      window.sessionStorage.removeItem(CHECKOUT_KEY);
      router.push(`/order/${orderBody.orderId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <ul className="mt-6 flex flex-col gap-2">
        {cart.lines.map((l) => (
          <li key={l.menuItemId} className="flex justify-between text-sm">
            <span>{l.name} × {l.quantity}</span>
            <span>{formatINR(l.unitPriceInr * l.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-6 flex flex-col gap-1 text-sm">
        <div className="flex justify-between"><dt className="text-text-muted">Subtotal</dt><dd>{formatINR(quote?.subtotalInr ?? cartSubtotal(cart))}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted">GST (5%)</dt><dd>{formatINR(quote?.gstInr ?? gstOn(cartSubtotal(cart)))}</dd></div>
        <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{quote ? formatINR(quote.totalInr) : '—'}</dd></div>
      </dl>
      {error ? <p role="alert" className="mt-4 rounded-card bg-surface-2 p-3 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !quote}
        onClick={placeOrder}
        className="mt-6 min-h-11 w-full rounded-pill bg-accent px-6 py-3 font-semibold text-accent-ink disabled:opacity-50"
      >
        Place order and pay
      </button>
    </div>
  );
}
