import { normalizeIndianMobile } from '@/lib/auth/phone';

test.each([
  ['98765 43210', '+919876543210'],
  ['98765-43210', '+919876543210'],
  ['09876543210', '+919876543210'],
  ['+91 98765 43210', '+919876543210'],
  ['919876543210', '+919876543210'],
  ['9123456789', '+919123456789'],
])('accepts %s', (input, e164) => {
  expect(normalizeIndianMobile(input)).toBe(e164);
});

test.each([
  '5876543210',    // starts with 5
  '987654321',     // 9 digits
  '98765432109',   // 11 digits without a leading 0
  '+1 2025550123', // US number
  '+910987654321', // +91 followed by 0
  '98765abcde',
  '',
])('rejects %j (Review Focus 1)', (input) => {
  expect(normalizeIndianMobile(input)).toBeNull();
});
