import { formatINR } from '@/lib/ui/format';

test('uses Indian digit grouping', () => {
  expect(formatINR(122500)).toBe('₹1,22,500.00');
});

test('two decimals for shares like ₹220.50', () => {
  expect(formatINR(220.5)).toBe('₹220.50');
});

test('zero renders as ₹0.00', () => {
  expect(formatINR(0)).toBe('₹0.00');
});
