import { kdsLoad, backpressureWarning, KDS_SLOT_CAPACITY } from '@/lib/kds/load';

test('load is open tickets over 25 slots, rounded to 2 places (PDF: 18 of 25 is 72%)', () => {
  expect(KDS_SLOT_CAPACITY).toBe(25);
  expect(kdsLoad(18)).toBe(0.72);
  expect(kdsLoad(0)).toBe(0);
});

test('load is capped at 1.00', () => {
  expect(kdsLoad(30)).toBe(1);
});

test('backpressure warning fires only above 85%', () => {
  expect(backpressureWarning(0.85)).toBe(false);
  expect(backpressureWarning(0.86)).toBe(true);
});
