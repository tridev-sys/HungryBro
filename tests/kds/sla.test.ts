import { slaState, slaMinutesFor } from '@/lib/kds/sla';

test('green under 5 minutes', () => {
  expect(slaState(4.99, 8)).toBe('green');
});

test('yellow at exactly 5 minutes and at exactly the SLA (Review Focus 4)', () => {
  expect(slaState(5, 8)).toBe('yellow');
  expect(slaState(8, 8)).toBe('yellow');
});

test('red one second past the SLA (Review Focus 4)', () => {
  expect(slaState(8 + 1 / 60, 8)).toBe('red');
});

test('SLA is 8 minutes dine-in and 12 minutes delivery', () => {
  expect(slaMinutesFor('DINE_IN')).toBe(8);
  expect(slaMinutesFor('DELIVERY')).toBe(12);
});
