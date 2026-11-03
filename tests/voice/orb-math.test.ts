import { orbScale } from '@/components/voice/orb-math';

test('orbScale maps 0..1 onto 1.0..1.35 and clamps outside it', () => {
  expect(orbScale(0)).toBe(1);
  expect(orbScale(1)).toBeCloseTo(1.35);
  expect(orbScale(-1)).toBe(1);
  expect(orbScale(3)).toBeCloseTo(1.35);
});

test('orbScale treats NaN and Infinity as silence', () => {
  expect(orbScale(Number.NaN)).toBe(1);
  expect(orbScale(Number.POSITIVE_INFINITY)).toBe(1);
});

test('orbScale is monotonic non-decreasing', () => {
  let prev = orbScale(0);
  for (let i = 1; i <= 20; i++) {
    const s = orbScale(i / 20);
    expect(s).toBeGreaterThanOrEqual(prev);
    prev = s;
  }
});
