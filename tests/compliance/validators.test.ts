import { readFileSync } from 'node:fs';
import { isValidGstin, isValidFssai, isValidVpa, UPI_VPA_PATTERN } from '@/lib/compliance/validators';

test('GSTIN follows the standard 15-character pattern', () => {
  expect(isValidGstin('29ABCDE1234F1Z5')).toBe(true);
  expect(isValidGstin(' 29abcde1234f1z5 ')).toBe(true);
  expect(isValidGstin('29ABCDE1234F1Z')).toBe(false);   // 14 characters
  expect(isValidGstin('29ABCDE1234F1X5')).toBe(false);  // position 14 must be Z
  expect(isValidGstin('2AABCDE1234F1Z5')).toBe(false);  // state code not digits
  expect(isValidGstin('29ABCDE12345F1Z5')).toBe(false); // 5 digits in the middle
});

test('FSSAI is exactly 14 digits', () => {
  expect(isValidFssai('11523999000123')).toBe(true);
  expect(isValidFssai('1152399900012')).toBe(false);
  expect(isValidFssai('1152399900012A')).toBe(false);
});

test('VPA is name@bank', () => {
  expect(isValidVpa('ravi.k@okhdfcbank')).toBe(true);
  expect(isValidVpa('98765@paytm')).toBe(true);
  expect(isValidVpa('ravi@')).toBe(false);
  expect(isValidVpa('ravi')).toBe(false);
  expect(isValidVpa('a@1bank')).toBe(false);
});

test('VPA regex matches the SQL CHECK in migration 004', () => {
  const sql = readFileSync('db/migrations/004_auth_ratings_compliance.sql', 'utf8');
  expect(sql).toContain("'^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$'");
  expect(UPI_VPA_PATTERN.source).toBe('^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$');
});
