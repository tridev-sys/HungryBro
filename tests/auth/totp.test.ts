import * as OTPAuth from 'otpauth';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { beginEnrolment, activateTotp, isTotpEnabled, RECOVERY_CODE_COUNT } from '@/lib/auth/totp';
import { decryptCredentials } from '@/lib/pos/credentials';
import { makeUser } from '../helpers/db';

const pool = getAdminPool();
const KEY = Buffer.alloc(32, 0x37);

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = KEY.toString('base64');
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

function codeFrom(otpauthUri: string, timestamp = Date.now()): string {
  return OTPAuth.URI.parse(otpauthUri).generate({ timestamp });
}

test('enrolment returns an otpauth URI and a QR code image, and does not enable 2FA yet', async () => {
  const userId = await makeUser(pool);
  const r = await beginEnrolment(pool, userId);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
  expect(r.otpauthUri).toContain('algorithm=SHA1');
  expect(r.otpauthUri).toContain('digits=6');
  expect(r.otpauthUri).toContain('period=30');
  expect(r.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  expect(await isTotpEnabled(pool, userId)).toBe(false);
});

test('activation with a valid code enables 2FA and issues the recovery codes once', async () => {
  const userId = await makeUser(pool);
  const enrol = await beginEnrolment(pool, userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const r = await activateTotp(pool, userId, codeFrom(enrol.otpauthUri));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
  expect(RECOVERY_CODE_COUNT).toBe(10);
  expect(new Set(r.recoveryCodes).size).toBe(10);
  for (const c of r.recoveryCodes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await isTotpEnabled(pool, userId)).toBe(true);
});

test('activation with a wrong code is rejected and leaves 2FA off', async () => {
  const userId = await makeUser(pool);
  const enrol = await beginEnrolment(pool, userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const valid = codeFrom(enrol.otpauthUri);
  // A code from well outside the +/-1 step window is wrong with near certainty.
  const far = codeFrom(enrol.otpauthUri, Date.now() - 10 * 60 * 1000);
  const wrong = far === valid ? String((Number(valid) + 1) % 1_000_000).padStart(6, '0') : far;
  expect(await activateTotp(pool, userId, wrong)).toEqual({ ok: false, reason: 'WRONG_CODE' });
  expect(await isTotpEnabled(pool, userId)).toBe(false);
  expect(await activateTotp(pool, userId, codeFrom(enrol.otpauthUri))).toMatchObject({ ok: true });
});

test('activation without a pending enrolment is refused', async () => {
  const userId = await makeUser(pool);
  expect(await activateTotp(pool, userId, '123456')).toEqual({ ok: false, reason: 'NO_PENDING_ENROLMENT' });
});

test('enrolment is refused once 2FA is enabled', async () => {
  const userId = await makeUser(pool);
  const enrol = await beginEnrolment(pool, userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  await activateTotp(pool, userId, codeFrom(enrol.otpauthUri));
  expect(await beginEnrolment(pool, userId)).toEqual({ ok: false, reason: 'ALREADY_ENABLED' });
});

test('the TOTP secret is encrypted at rest: the stored value is not the plain secret', async () => {
  const userId = await makeUser(pool);
  const enrol = await beginEnrolment(pool, userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const plainSecret = OTPAuth.URI.parse(enrol.otpauthUri).secret.base32;

  const { rows } = await pool.query<{ secret_encrypted: unknown }>(
    'SELECT secret_encrypted FROM user_totp WHERE user_id = $1', [userId]);
  expect(rows).toHaveLength(1);
  const stored = JSON.stringify(rows[0].secret_encrypted);
  expect(stored).not.toContain(plainSecret);
  expect(stored).toMatch(/"iv"/);
  expect(stored).toMatch(/"tag"/);
  expect(stored).toMatch(/"ciphertext"/);

  // It decrypts with the TOTP key, and not with another key.
  expect(decryptCredentials(rows[0].secret_encrypted, KEY)).toEqual({ secret: plainSecret });
  expect(() => decryptCredentials(rows[0].secret_encrypted, Buffer.alloc(32, 0x01))).toThrow();
});

test('recovery codes are stored as digests, not as the displayed codes', async () => {
  const userId = await makeUser(pool);
  const enrol = await beginEnrolment(pool, userId);
  if (!enrol.ok) throw new Error('enrolment failed');
  const r = await activateTotp(pool, userId, codeFrom(enrol.otpauthUri));
  if (!r.ok) throw new Error('activation failed');
  const { rows } = await pool.query<{ code_hash: string }>(
    'SELECT code_hash FROM totp_recovery_codes WHERE user_id = $1', [userId]);
  expect(rows).toHaveLength(10);
  const hashes = rows.map((x) => x.code_hash).join(' ');
  for (const c of r.recoveryCodes) expect(hashes).not.toContain(c.replace('-', ''));
});
