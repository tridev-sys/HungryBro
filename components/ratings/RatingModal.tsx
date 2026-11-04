'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { RATING_TAGS, type RatingTag } from '@/lib/ratings/schema';
import { canSubmitRating, toggleTag } from './rating-state';

export interface RatingModalProps {
  orderRefId: string;
  restaurantName: string;
  onSubmitted?: () => void;
  onClose: () => void;
}

const ERROR_COPY: Record<string, string> = {
  UNAUTHENTICATED: 'Sign in to rate this order.',
  INVALID_BODY: 'Choose a star rating before you submit.',
  ORDER_NOT_FOUND: 'We could not find this order.',
  ORDER_NOT_COMPLETED: 'This order is not complete yet.',
  WINDOW_EXPIRED: 'The 2-second rating window for this order has closed.',
  ALREADY_RATED: 'You have already rated this order.',
};

export function RatingModal({ orderRefId, restaurantName, onSubmitted, onClose }: RatingModalProps) {
  const [score, setScore] = useState<number | null>(null);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!canSubmitRating(score, tags)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_ref_id: orderRefId, rating_score: score, review_tags: tags }),
      });
      if (res.ok) {
        setSaved(true);
        onSubmitted?.();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(ERROR_COPY[body.error ?? ''] ?? 'Something went wrong. Please try again.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rating-title" className="fixed inset-0 flex items-end justify-center bg-[var(--color-bg)]/70 p-4">
      <div className="w-full max-w-md rounded-t-[var(--radius-card)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-xl">
        <h2 id="rating-title" className="text-lg font-semibold">Rate your experience (verified order)</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{restaurantName}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Only diners with verified, completed payments can submit ratings.</p>

        {saved ? (
          <p role="status" className="mt-4 text-sm font-medium text-[var(--color-accent)]">
            Thank you. Your rating for this order is saved.
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Star rating" className="mt-4 flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  aria-checked={score === n}
                  onClick={() => setScore(n)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1"
                >
                  <Star
                    className={n <= (score ?? 0) ? 'fill-[var(--color-sla-yellow)] text-[var(--color-sla-yellow)]' : 'text-[var(--color-text-muted)]'}
                    size={32}
                  />
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {RATING_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tags.includes(tag)}
                  onClick={() => setTags((prev) => toggleTag(prev, tag))}
                  className={`inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border px-3 py-1 text-sm ${
                    tags.includes(tag)
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                      : 'border-[var(--color-surface-2)] bg-[var(--color-surface-2)]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </>
        )}

        {error && !saved && <p role="alert" className="mt-3 text-sm text-[var(--color-sla-red)]">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          {saved ? (
            <button type="button" onClick={onClose} className="min-h-11 rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 py-2 text-sm text-[var(--color-accent-ink)]">
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="min-h-11 px-4 py-2 text-sm">Not now</button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !canSubmitRating(score, tags)}
                className="min-h-11 rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 py-2 text-sm text-[var(--color-accent-ink)] disabled:opacity-40"
              >
                {submitting ? 'Submitting...' : 'Submit rating'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
