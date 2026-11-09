'use client';
import { useEffect, useState } from 'react';
import { formatINR } from '@/lib/ui/format';
import type { OrderStatusView } from '@/lib/delivery-customer/order-status';

const POLL_MS = 5000;
const FINAL = new Set(['delivered', 'cancelled']);

/** Shows the order and refreshes it every few seconds until it is delivered or cancelled. */
export function OrderStatus({ initial }: { initial: OrderStatusView }) {
  const [view, setView] = useState<OrderStatusView>(initial);

  // A new server render (for example after a sign-in refresh) replaces the polled state.
  useEffect(() => {
    setView(initial);
  }, [initial]);

  useEffect(() => {
    if (FINAL.has(view.status)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${view.id}`, { cache: 'no-store' });
        if (res.ok) setView((await res.json()) as OrderStatusView);
      } catch {
        // Keep the last known state; the next tick tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [view.id, view.status]);

  return (
    <div>
      <p className="text-sm text-text-muted">{view.restaurantName}</p>
      <h1 className="mt-1 text-2xl font-semibold" aria-live="polite">{view.statusText}</h1>
      <ul className="mt-6 flex flex-col gap-2">
        {view.lines.map((l) => (
          <li key={`${l.name}-${l.quantity}`} className="flex justify-between text-sm">
            <span>{l.name} × {l.quantity}</span>
            <span>{formatINR(l.lineTotalInr)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex justify-between font-semibold">
        <span>Total</span>
        <span>{formatINR(view.totalInr)}</span>
      </p>
      {view.upiIntentUrl ? (
        <a
          href={view.upiIntentUrl}
          className="mt-6 flex min-h-11 items-center justify-center rounded-pill bg-accent px-6 py-3 font-semibold text-accent-ink"
        >
          Pay with UPI
        </a>
      ) : null}
    </div>
  );
}
