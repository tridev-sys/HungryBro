'use client';
import { useState } from 'react';

const ERRORS: Record<string, string> = {
  WINDOW_EXPIRED: 'The rating window for this order has closed.',
  ALREADY_RATED: 'This order is already rated.',
  ORDER_NOT_COMPLETED: 'You can rate this order once it is delivered.',
  ORDER_NOT_FOUND: 'We could not find this order.',
};

/**
 * Rating after delivery. Shown only for a delivered, unrated order. The database rule (2-second window
 * after settlement, one rating per order) is authoritative; a refusal is shown as the reason.
 */
export function RatingPanel({ orderRefId, status, rated }: { orderRefId: string | null; status: string; rated: boolean }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!orderRefId || status !== 'delivered' || rated) return null;
  if (done) return <p className="mt-8 text-sm">Thanks for rating your order.</p>;

  async function submit(score: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_ref_id: orderRefId, rating_score: score, review_tags: [] }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(ERRORS[body.error] ?? 'We could not save your rating. Please try again.');
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-card bg-surface p-4">
      <h2 className="font-medium">How was your order?</h2>
      <div role="group" aria-label="Rate your order" className="mt-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`Rate ${score} out of 5`}
            disabled={busy}
            onClick={() => submit(score)}
            className="min-h-11 min-w-11 rounded-pill bg-surface-2 px-3 disabled:opacity-50"
          >
            {score}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-text-muted">{error}</p> : null}
    </section>
  );
}
