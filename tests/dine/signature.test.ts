import { issueSignatureToken, issueSessionToken, verifyTableSignature } from '@/lib/dine/signature';

test('signature tokens are 32 hex characters and differ between calls', () => {
  const a = issueSignatureToken();
  expect(a).toMatch(/^[0-9a-f]{32}$/);
  expect(issueSignatureToken()).not.toBe(a);
});

test('session tokens are 64 hex characters', () => {
  expect(issueSessionToken()).toMatch(/^[0-9a-f]{64}$/);
});

test('verifyTableSignature accepts only the stored value', () => {
  const stored = issueSignatureToken();
  expect(verifyTableSignature(stored, stored)).toBe(true);
  expect(verifyTableSignature(stored, issueSignatureToken())).toBe(false);
  expect(verifyTableSignature(stored, stored.slice(0, 31))).toBe(false);
  expect(verifyTableSignature(stored, undefined)).toBe(false);
  expect(verifyTableSignature(stored, null)).toBe(false);
});
