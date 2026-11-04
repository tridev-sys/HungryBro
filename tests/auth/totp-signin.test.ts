import * as OTPAuth from 'otpauth';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp } from '@/lib/auth/otp';
import { DevFixedCodeProvider } from '@/lib/auth/otp-providers';
import { completeLogin, completeTotpLogin } from '@/lib/auth/login';
import { beginEnrolment, activateTotp } from '@/lib/auth/totp';
import { verifySession } from '@/lib/auth/session';
import { randomPhone } from '../helpers/db';

const pool = getAdminPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x37).toString('base64');
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

/** A diner with a phone number and 2FA enabled. Returns the phone, the TOTP handle, and recovery codes. */
async function enrolledDiner() {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  const first = await completeLogin(pool, phone, '123456');
  if (!first.ok || !('token' in first)) throw new Error('setup login failed');
  const enrol = await beginEnrolment(pool, first.userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const totp = OTPAuth.URI.parse(enrol.otpauthUri);
  const activated = await activateTotp(pool, first.userId, totp.generate());
  if (!activated.ok) throw new Error('activation failed');
  // Activation has used the current 30-second step, so sign-in tests take the code for the next step.
  // That is still inside the +/-1 window and is a different counter, so it is accepted once.
  const nextStepCode = () => totp.generate({ timestamp: Date.now() + 30_000 });
  return { phone, userId: first.userId, totp, nextStepCode, recoveryCodes: activated.recoveryCodes };
}

/** A fresh OTP step for the phone. The sign-in code is always the dev code in tests. */
async function startLogin(phone: string) {
  await requestOtp(pool, dev, phone);
  return completeLogin(pool, phone, '123456');
}

test('with 2FA enabled, the email/OTP step alone does not sign in', async () => {
  const d = await enrolledDiner();
  const r = await startLogin(d.phone);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect('token' in r).toBe(false);
  if (!('totpRequired' in r)) throw new Error('expected a TOTP step');
  expect(r.totpRequired).toBe(true);
  expect(r.userId).toBe(d.userId);
  // The pending token is not a session: the session verifier refuses it.
  expect(await verifySession(r.pendingToken)).toBeNull();
});

test('a wrong TOTP code after the OTP step is rejected', async () => {
  const d = await enrolledDiner();
  const r = await startLogin(d.phone);
  if (!r.ok || !('pendingToken' in r)) throw new Error('expected pending state');
  const wrong = String((Number(d.totp.generate({ timestamp: Date.now() - 600_000 })) + 1) % 1_000_000).padStart(6, '0');
  expect(await completeTotpLogin(pool, r.pendingToken, wrong)).toEqual({ ok: false, error: 'That code is not right.' });
});

test('a valid TOTP code completes sign-in with a verifiable session', async () => {
  const d = await enrolledDiner();
  const r = await startLogin(d.phone);
  if (!r.ok || !('pendingToken' in r)) throw new Error('expected pending state');
  const done = await completeTotpLogin(pool, r.pendingToken, d.nextStepCode());
  expect(done.ok).toBe(true);
  if (!done.ok) return;
  expect(await verifySession(done.token)).toEqual({ userId: d.userId, role: 'diner' });
});

test('the same TOTP code cannot be used twice (replay within its window)', async () => {
  const d = await enrolledDiner();
  const first = await startLogin(d.phone);
  if (!first.ok || !('pendingToken' in first)) throw new Error('expected pending state');
  const code = d.nextStepCode();
  expect((await completeTotpLogin(pool, first.pendingToken, code)).ok).toBe(true);

  const second = await startLogin(d.phone);
  if (!second.ok || !('pendingToken' in second)) throw new Error('expected pending state');
  expect((await completeTotpLogin(pool, second.pendingToken, code)).ok).toBe(false);
});

test('a missing, forged, or expired pending token is refused', async () => {
  const d = await enrolledDiner();
  expect((await completeTotpLogin(pool, '', d.nextStepCode())).ok).toBe(false);
  expect((await completeTotpLogin(pool, 'not.a.jwt', d.nextStepCode())).ok).toBe(false);
  const r = await startLogin(d.phone);
  if (!r.ok || !('pendingToken' in r)) throw new Error('expected pending state');
  const forged = r.pendingToken.slice(0, -4) + 'AAAA';
  expect((await completeTotpLogin(pool, forged, d.nextStepCode())).ok).toBe(false);
});

test('a recovery code signs in once, then is spent', async () => {
  const d = await enrolledDiner();
  const code = d.recoveryCodes[0];

  const first = await startLogin(d.phone);
  if (!first.ok || !('pendingToken' in first)) throw new Error('expected pending state');
  const done = await completeTotpLogin(pool, first.pendingToken, code);
  expect(done.ok).toBe(true);
  if (!done.ok) return;
  expect(await verifySession(done.token)).toEqual({ userId: d.userId, role: 'diner' });

  const second = await startLogin(d.phone);
  if (!second.ok || !('pendingToken' in second)) throw new Error('expected pending state');
  expect((await completeTotpLogin(pool, second.pendingToken, code)).ok).toBe(false);
});

test('a recovery code is accepted in the normalised form (case and dash ignored)', async () => {
  const d = await enrolledDiner();
  const code = d.recoveryCodes[1];
  const r = await startLogin(d.phone);
  if (!r.ok || !('pendingToken' in r)) throw new Error('expected pending state');
  const typed = code.replace('-', '').toLowerCase();
  expect((await completeTotpLogin(pool, r.pendingToken, typed)).ok).toBe(true);
});
