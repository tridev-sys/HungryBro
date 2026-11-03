import { simulatedLevel } from '@/lib/voice/simulated';

test('simulated level stays in [0, 1] while the mic is on', () => {
  for (let t = 0; t < 5000; t += 37) {
    const v = simulatedLevel(t, true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test('simulated level is zero while the mic is off', () => {
  expect(simulatedLevel(1234, false)).toBe(0);
});
