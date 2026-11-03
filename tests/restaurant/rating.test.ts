import { formatRating } from '@/lib/restaurant/rating';

test('a restaurant with no verified reviews shows "No ratings yet" (decision 1)', () => {
  expect(formatRating(0, 0)).toBe('No ratings yet');
});

test('a rated restaurant shows the rating and the verified count', () => {
  expect(formatRating(4.8, 1240)).toBe('4.8/5.0, 1240 verified');
});
