import { getAdminPool, runMigrations } from '@/lib/db/client';
import { sendOtpForPhone, completeLogin } from '@/lib/auth/login';
import { DevFixedCodeProvider } from '@/lib/auth/otp-providers';
import { verifySession } from '@/lib/auth/session';
import { randomPhone } from '../helpers/db';

const pool = getAdminPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('invalid phone stays on the phone step with an error', async () => {
  const s = await sendOtpForPhone(pool, dev, '1234');
  expect(s.step).toBe('phone');
  expect(s.error).toContain('valid 10-digit Indian mobile number');
});

test('valid phone moves to the OTP step with the normalized number', async () => {
  // A random number, so repeated runs stay under the 3-per-hour OTP limit.
  const phone = randomPhone();
  const s = await sendOtpForPhone(pool, dev, phone.replace('+91', '+91 '));
  expect(s).toEqual({ step: 'otp', phone });
});

test('correct dev code signs in a new diner with a verifiable session', async () => {
  const phone = randomPhone();
  await sendOtpForPhone(pool, dev, phone);
  const r = await completeLogin(pool, phone, '123456');
  expect(r.ok).toBe(true);
  if (!r.ok || !('token' in r)) return;
  expect(r.role).toBe('diner');
  expect(await verifySession(r.token)).toEqual({ userId: r.userId, role: 'diner' });
});

test('wrong code returns the error copy and no token', async () => {
  const phone = randomPhone();
  await sendOtpForPhone(pool, dev, phone);
  expect(await completeLogin(pool, phone, '999999')).toEqual({
    ok: false, error: 'That code is not right.',
  });
});

test('a failed SMS send keeps the user on the phone step with a retry message', async () => {
  const phone = randomPhone();
  const failing = {
    name: 'msg91' as const,
    codeFor: () => '123456',
    send: async () => ({ ok: false as const, code: 'OTP_SEND_FAILED' as const }),
  };
  const s = await sendOtpForPhone(pool, failing, phone);
  expect(s.step).toBe('phone');
  expect(s.phone).toBeUndefined();
  expect(s.error).toBe('We could not send the code to this number. Please try again.');
});
