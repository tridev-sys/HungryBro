import { RATING_TAGS, type RatingTag } from '@/lib/ratings/schema';

/** True only for a whole score from 1 to 5 and tags that are all known. */
export function canSubmitRating(score: number | null, tags: readonly string[]): boolean {
  if (score === null || !Number.isInteger(score) || score < 1 || score > 5) return false;
  return tags.every((t) => (RATING_TAGS as readonly string[]).includes(t));
}

export function toggleTag(tags: readonly RatingTag[], tag: RatingTag): RatingTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}
