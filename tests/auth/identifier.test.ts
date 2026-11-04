import { normalizeIdentifier, normalizeEmail } from '@/lib/auth/identifier';

test('an email is trimmed and lowercased', () => {
  expect(normalizeEmail('  Member.Name@Example.TEST ')).toBe('member.name@example.test');
  expect(normalizeIdentifier(' Diner@Example.test ')).toEqual({ kind: 'email', value: 'diner@example.test' });
});

test('malformed emails are rejected, never treated as phone numbers', () => {
  for (const bad of ['@example.test', 'a@b', 'two words@example.test', 'a@@example.test', 'x'.repeat(250) + '@e.co']) {
    expect(normalizeEmail(bad)).toBeNull();
  }
  expect(normalizeIdentifier('not an email@')).toBeNull();
});

test('a phone number still normalises to E.164 (existing behaviour)', () => {
  expect(normalizeIdentifier('98765 43210')).toEqual({ kind: 'phone', value: '+919876543210' });
  expect(normalizeIdentifier('+91 9876543210')).toEqual({ kind: 'phone', value: '+919876543210' });
  expect(normalizeIdentifier('1234')).toBeNull();
});
