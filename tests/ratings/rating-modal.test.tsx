import { renderToStaticMarkup } from 'react-dom/server';
import { canSubmitRating, toggleTag } from '@/components/ratings/rating-state';
import { RatingModal } from '@/components/ratings/RatingModal';

test('canSubmitRating needs a whole score from 1 to 5 and known tags only', () => {
  expect(canSubmitRating(null, [])).toBe(false);
  expect(canSubmitRating(0, [])).toBe(false);
  expect(canSubmitRating(6, [])).toBe(false);
  expect(canSubmitRating(3.5, [])).toBe(false);
  expect(canSubmitRating(4, ['Great Vibes'])).toBe(false);
  expect(canSubmitRating(4, ['Fast Prep'])).toBe(true);
});

test('toggleTag adds and removes a tag', () => {
  expect(toggleTag([], 'Piping Hot')).toEqual(['Piping Hot']);
  expect(toggleTag(['Piping Hot'], 'Piping Hot')).toEqual([]);
});

test('modal renders five star radios and the four named chips', () => {
  const html = renderToStaticMarkup(
    <RatingModal orderRefId="00000000-0000-4000-8000-000000000000" restaurantName="Meghna Foods"
      onSubmitted={() => {}} onClose={() => {}} />);
  expect((html.match(/role="radio"/g) ?? []).length).toBe(5);
  expect(html).toContain('aria-label="5 stars"');
  for (const tag of ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec']) {
    expect(html).toContain(tag);
  }
  expect(html).toContain('verified, completed payments');
});
