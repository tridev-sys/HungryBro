import { encryptCredentials, decryptCredentials, loadPosKey } from '@/lib/pos/credentials';

const key = Buffer.alloc(32, 7);
const secret = { webhook_secret: 'whsec-plain-1', api_key: 'key-plain-1' };

test('stored value is not plaintext and round-trips', () => {
  const stored = encryptCredentials(secret, key);
  const text = JSON.stringify(stored);
  expect(Object.keys(stored).sort()).toEqual(['ciphertext', 'iv', 'tag']);
  expect(text).not.toContain('whsec-plain-1');
  expect(text).not.toContain('webhook_secret');
  expect(decryptCredentials(stored, key)).toEqual(secret);
});

test('a tampered ciphertext fails authentication', () => {
  const stored = encryptCredentials(secret, key);
  const c = Buffer.from(stored.ciphertext, 'base64');
  c[0] ^= 1;
  expect(() => decryptCredentials({ ...stored, ciphertext: c.toString('base64') }, key)).toThrow();
});

test('loadPosKey rejects a missing key or one that is not 32 bytes of base64', () => {
  expect(() => loadPosKey({})).toThrow(/POS_CREDENTIALS_KEY/);
  expect(() => loadPosKey({ POS_CREDENTIALS_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
});
