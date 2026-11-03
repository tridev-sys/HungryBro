'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { RATING_TAGS, type RatingTag } from '@/lib/ratings/schema';
import { canSubmitRating, toggleTag } from './rating-state';

export interface RatingModalProps {
  orderRefId: string;
  restaurantName: string;
  onSubmitted: () => void;
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
        onSubmitted();
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
    <div role="dialog" aria-modal="true" aria-labelledby="rating-title" className="fixed inset-0 flex items-end justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl">
        <h2 id="rating-title" className="text-lg font-semibold">Rate your experience (verified order)</h2>
        <p className="mt-1 text-sm text-neutral-600">{restaurantName}</p>
        <p className="mt-1 text-xs text-neutral-500">Only diners with verified, completed payments can submit ratings.</p>

        <div role="radiogroup" aria-label="Star rating" className="mt-4 flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              aria-checked={score === n}
              onClick={() => setScore(n)}
              className="rounded p-1"
            >
              <Star className={n <= (score ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-neutral-300'} size={32} />
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
              className={`rounded-full border px-3 py-1 text-sm ${tags.includes(tag) ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'}`}
            >
              {tag}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Not now</button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmitRating(score, tags)}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {submitting ? 'Submitting...' : 'Submit rating'}
          </button>
        </div>
      </div>
    </div>
  );
}
