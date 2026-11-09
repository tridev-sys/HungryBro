import { vi } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { allowSignInStep, SIGN_IN_LIMITED_MESSAGE, SIGN_IN_LIMITS } from '@/lib/auth/sign-in-limit';
import { sendOtpAction, verifyOtpAction, verifyTotpAction } from '@/app/auth/login/actions';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const store = new RedisRateLimitStore(redis);
afterAll(async () => { await redis.quit(); });

const randomIp = () => `198.51.100.${randomUUID()}`;
const hdrs = (ip: string) => new Headers({ 'x-real-ip': ip });

test('a sign-in step is refused after the per-IP limit, and other IPs are not affected', async () => {
  const ip = randomIp();
  const cap = SIGN_IN_LIMITS.sendCode.capacity;
  for (let i = 0; i < cap; i++) expect(await allowSignInStep('sendCode', hdrs(ip), store)).toBe(true);
  expect(await allowSignInStep('sendCode', hdrs(ip), store)).toBe(false);
  expect(await allowSignInStep('sendCode', hdrs(randomIp()), store)).toBe(true);
});

test('the verify-code step has its own bucket and does not share the send-code count', async () => {
  const ip = randomIp();
  for (let i = 0; i < SIGN_IN_LIMITS.sendCode.capacity; i++) await allowSignInStep('sendCode', hdrs(ip), store);
  expect(await allowSignInStep('sendCode', hdrs(ip), store)).toBe(false);
  expect(await allowSignInStep('verifyCode', hdrs(ip), store)).toBe(true);
});

test('the send-code action returns the generic message once the IP is limited', async () => {
  const ip = randomIp();
  for (let i = 0; i < SIGN_IN_LIMITS.sendCode.capacity; i++) await allowSignInStep('sendCode', hdrs(ip), store);
  vi.mocked(headers).mockResolvedValue(hdrs(ip) as never);
  const fd = new FormData();
  fd.set('identifier', '9876543210');
  expect(await sendOtpAction({ step: 'phone' }, fd)).toEqual({ step: 'phone', error: SIGN_IN_LIMITED_MESSAGE });
});

test('the verify-code and TOTP actions return the generic message once the IP is limited', async () => {
  const ip = randomIp();
  for (let i = 0; i < SIGN_IN_LIMITS.verifyCode.capacity; i++) await allowSignInStep('verifyCode', hdrs(ip), store);
  vi.mocked(headers).mockResolvedValue(hdrs(ip) as never);
  const fd = new FormData();
  fd.set('identifier', '9876543210');
  fd.set('code', '123456');
  expect(await verifyOtpAction({ step: 'otp' }, fd)).toEqual(
    { step: 'otp', phone: '9876543210', error: SIGN_IN_LIMITED_MESSAGE });
  expect(await verifyTotpAction({ step: 'totp' }, fd)).toEqual({ step: 'totp', error: SIGN_IN_LIMITED_MESSAGE });
});
