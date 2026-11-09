import * as OTPAuth from 'otpauth';
import Redis from 'ioredis';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp } from '@/lib/auth/otp';
import { DevFixedCodeProvider } from '@/lib/auth/otp-providers';
import { completeLogin, completeTotpLogin } from '@/lib/auth/login';
import { beginEnrolment, activateTotp } from '@/lib/auth/totp';
import { SECOND_FACTOR_MAX_ATTEMPTS } from '@/lib/auth/second-factor-lock';
import { randomPhone } from '../helpers/db';

const pool = getAdminPool();
const dev = new DevFixedCodeProvider();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x37).toString('base64');
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await redis.quit(); await pool.end(); });

const GENERIC_LOCK = 'Too many incorrect codes. Try again later.';
const WRONG = 'That code is not right.';

/** A diner with 2FA enabled and a helper that starts a fresh email step (new pending token). */
async function enrolled() {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  const first = await completeLogin(pool, phone, '123456');
  if (!first.ok || !('token' in first)) throw new Error('setup login failed');
  const enrol = await beginEnrolment(pool, first.userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const totp = OTPAuth.URI.parse(enrol.otpauthUri);
  const activated = await activateTotp(pool, first.userId, totp.generate());
  if (!activated.ok) throw new Error('activation failed');
  const nextStepCode = () => totp.generate({ timestamp: Date.now() + 30_000 });
  const wrongCode = () => String((Number(totp.generate({ timestamp: Date.now() - 600_000 })) + 1) % 1_000_000).padStart(6, '0');
  const pendingFor = async () => {
    await requestOtp(pool, dev, phone);
    const r = await completeLogin(pool, phone, '123456');
    if (!r.ok || !('pendingToken' in r)) throw new Error('expected pending state');
    return r.pendingToken;
  };
  return { userId: first.userId, nextStepCode, wrongCode, pendingFor };
}

test('the second step refuses further guesses after 5 wrong codes, even with the right code', async () => {
  expect(SECOND_FACTOR_MAX_ATTEMPTS).toBe(5);
  const d = await enrolled();
  const pending = await d.pendingFor();
  for (let i = 0; i < 5; i++) {
    expect(await completeTotpLogin(pool, pending, d.wrongCode(), redis)).toEqual({ ok: false, error: WRONG });
  }
  expect(await completeTotpLogin(pool, pending, d.nextStepCode(), redis)).toEqual({ ok: false, error: GENERIC_LOCK });
});

test('a new pending token for the same user is locked too (the count is per user)', async () => {
  const d = await enrolled();
  const first = await d.pendingFor();
  for (let i = 0; i < 5; i++) await completeTotpLogin(pool, first, d.wrongCode(), redis);
  const second = await d.pendingFor();
  expect(await completeTotpLogin(pool, second, d.nextStepCode(), redis)).toEqual({ ok: false, error: GENERIC_LOCK });
});

test('a correct code before the limit signs in and resets the count', async () => {
  const d = await enrolled();
  const pending = await d.pendingFor();
  for (let i = 0; i < 4; i++) await completeTotpLogin(pool, pending, d.wrongCode(), redis);
  const done = await completeTotpLogin(pool, pending, d.nextStepCode(), redis);
  expect(done.ok).toBe(true);
  // After the reset, a new sign-in gets the full allowance again.
  const again = await d.pendingFor();
  for (let i = 0; i < 4; i++) {
    expect(await completeTotpLogin(pool, again, d.wrongCode(), redis)).toEqual({ ok: false, error: WRONG });
  }
});
