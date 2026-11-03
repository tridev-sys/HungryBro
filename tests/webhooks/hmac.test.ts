import { createHmac } from 'node:crypto';
import { verifyHmac } from '@/lib/webhooks/hmac';

const secret = 'whsec_test';
const body = '{"event":"item.stock"}';
const hex = createHmac('sha256', secret).update(body).digest('hex');
const b64 = createHmac('sha256', secret).update(body).digest('base64');

test('accepts a valid hex signature', () => {
  expect(verifyHmac({ secret, payload: body, signature: hex, encoding: 'hex' })).toBe(true);
});

test('accepts a valid base64 signature', () => {
  expect(verifyHmac({ secret, payload: body, signature: b64, encoding: 'base64' })).toBe(true);
});

test('rejects a wrong secret', () => {
  expect(verifyHmac({ secret: 'other', payload: body, signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a tampered body', () => {
  expect(verifyHmac({ secret, payload: body + ' ', signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a missing signature or secret without throwing', () => {
  expect(verifyHmac({ secret, payload: body, signature: undefined, encoding: 'hex' })).toBe(false);
  expect(verifyHmac({ secret: '', payload: body, signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a truncated signature without throwing', () => {
  expect(verifyHmac({ secret, payload: body, signature: hex.slice(0, 10), encoding: 'hex' })).toBe(false);
});
