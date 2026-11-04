import { bucketKeyForIp, bucketKeyForSession, clientIpFromHeaders } from '@/lib/ratelimit/keys';

test('session key never contains the raw token', () => {
  const k = bucketKeyForSession('eyJhbGciOiJIUzI1NiJ9.secret-part');
  expect(k.startsWith('rl:sess:')).toBe(true);
  expect(k).not.toContain('secret-part');
  expect(k.length).toBe('rl:sess:'.length + 32);
});

test('IP key is prefixed', () => {
  expect(bucketKeyForIp('203.0.113.9')).toBe('rl:ip:203.0.113.9');
});

test('Caddy-set X-Real-IP wins over any forwarded chain', () => {
  const h = new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.66' });
  expect(clientIpFromHeaders(h)).toBe('203.0.113.9');
});

test('client-sent X-Forwarded-For cannot pick its own IP (Review Focus 2)', () => {
  // Caddy appends the real peer to the end of the chain. The leftmost entry is attacker-controlled.
  const h = new Headers({ 'x-forwarded-for': '198.51.100.66, 203.0.113.9' });
  expect(clientIpFromHeaders(h)).toBe('203.0.113.9');
  expect(clientIpFromHeaders(new Headers())).toBe('unknown');
});
