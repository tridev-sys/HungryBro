import { slaMinutes, slaColor, isOverdue } from '@/lib/kds/timers';

test('SLA is 8 minutes for dine-in and 12 for delivery (decision 3)', () => {
  expect(slaMinutes('DINE_IN')).toBe(8);
  expect(slaMinutes('DELIVERY')).toBe(12);
});

test('dine-in colors: green under 5, yellow from 5 to under 8, red at 8', () => {
  expect(slaColor(0, 'DINE_IN')).toBe('green');
  expect(slaColor(4.99, 'DINE_IN')).toBe('green');
  expect(slaColor(5, 'DINE_IN')).toBe('yellow');
  expect(slaColor(7.99, 'DINE_IN')).toBe('yellow');
  expect(slaColor(8, 'DINE_IN')).toBe('red');
});

test('delivery colors: yellow from 5 up to 12, red at 12', () => {
  expect(slaColor(8, 'DELIVERY')).toBe('yellow');
  expect(slaColor(11.99, 'DELIVERY')).toBe('yellow');
  expect(slaColor(12, 'DELIVERY')).toBe('red');
});

test('overdue means past the SLA', () => {
  expect(isOverdue(7.99, 'DINE_IN')).toBe(false);
  expect(isOverdue(8, 'DINE_IN')).toBe(true);
  expect(isOverdue(11.99, 'DELIVERY')).toBe(false);
  expect(isOverdue(12, 'DELIVERY')).toBe(true);
});
