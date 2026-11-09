import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { DevFixedCodeProvider, selectOtpProvider } from '@/lib/auth/otp-providers';
import { randomPhone } from '../helpers/db';

const pool = getAdminPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('issues a challenge that expires in about 5 minutes', async () => {
  const phone = randomPhone();
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (expires_at - NOW()))::float8 AS ttl FROM otp_challenges WHERE phone_e164 = $1`, [phone]);
  expect(rows[0].ttl).toBeGreaterThan(290);
  expect(rows[0].ttl).toBeLessThanOrEqual(300);
});

test('a phone gets at most 3 challenges per hour; older challenges do not count', async () => {
  const phone = randomPhone();
  for (let i = 0; i < 3; i++) {
    expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
  }
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  await pool.query(`UPDATE otp_challenges SET created_at = NOW() - INTERVAL '61 minutes' WHERE phone_e164 = $1`, [phone]);
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
});

test('correct code signs in; the same code cannot be reused (single use)', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: true, e164: phone });
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('wrong codes return WRONG_CODE; the 6th attempt is locked (Review Focus 2)', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  for (let i = 0; i < 5; i++) {
    expect(await verifyOtp(pool, phone, '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
  }
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('an expired challenge is rejected even with the right code', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  await pool.query(`UPDATE otp_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE phone_e164 = $1`, [phone]);
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('invalid phone never creates a challenge (Review Focus 1)', async () => {
  expect(await requestOtp(pool, dev, '1234')).toEqual({ ok: false, reason: 'INVALID_PHONE' });
  expect(await verifyOtp(pool, '1234', '123456')).toEqual({ ok: false, reason: 'INVALID_PHONE' });
  const { rowCount } = await pool.query(`SELECT 1 FROM otp_challenges WHERE phone_e164 = '1234'`);
  expect(rowCount).toBe(0);
});

test('dev provider is refused in production (Review Focus 2)', () => {
  expect(() => selectOtpProvider({ OTP_PROVIDER: 'dev', NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  expect(selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'dev' }).name).toBe('dev');
  expect(() => selectOtpProvider({ NODE_ENV: 'test' })).toThrow(/No OTP provider/);
});

test('a failed provider send is reported as SEND_FAILED, not as sent', async () => {
  const phone = randomPhone();
  const failing = {
    name: 'msg91' as const,
    codeFor: () => '123456',
    send: async () => ({ ok: false as const, code: 'OTP_SEND_FAILED' as const }),
  };
  expect(await requestOtp(pool, failing, phone)).toEqual({ ok: false, reason: 'SEND_FAILED' });
});

test('a failed send still counts toward the 3-per-hour limit (challenge row is committed before send)', async () => {
  const phone = randomPhone();
  const failing = {
    name: 'msg91' as const,
    codeFor: () => '123456',
    send: async () => ({ ok: false as const, code: 'OTP_SEND_FAILED' as const }),
  };
  for (let i = 0; i < 3; i++) {
    expect(await requestOtp(pool, failing, phone)).toEqual({ ok: false, reason: 'SEND_FAILED' });
  }
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: false, reason: 'RATE_LIMITED' });
});
