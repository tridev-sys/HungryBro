import { getPool, runMigrations } from '@/lib/db/client';
import { createUserAfterOtp } from '@/lib/auth/sign-in';
import { addVpa, removeVpa, setDefaultVpa, listVpas, saveGstin, getProfile } from '@/lib/profile/service';
import { randomPhone } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

// Users are created only through the OTP path, so the helper records a verified challenge first.
const newUser = async () => {
  const phone = randomPhone();
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, consumed_at)
     VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes', NOW())`, [phone]);
  return (await createUserAfterOtp(pool, phone)).id;
};

test('adds a valid VPA and lists it for its owner only', async () => {
  const a = await newUser();
  const b = await newUser();
  expect(await addVpa(pool, a, 'ravi@okhdfcbank')).toEqual({ ok: true, vpa: 'ravi@okhdfcbank' });
  expect(await listVpas(pool, a)).toEqual(['ravi@okhdfcbank']);
  expect(await listVpas(pool, b)).toEqual([]);
});

test('rejects a malformed or duplicate VPA', async () => {
  const a = await newUser();
  expect(await addVpa(pool, a, 'not-a-vpa')).toEqual({ ok: false, reason: 'INVALID_VPA' });
  await addVpa(pool, a, 'ravi@okaxis');
  expect(await addVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: false, reason: 'DUPLICATE' });
});

test('set default requires a saved VPA; removing the default clears it', async () => {
  const a = await newUser();
  expect(await setDefaultVpa(pool, a, 'x@okaxis')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  await addVpa(pool, a, 'ravi@okaxis');
  expect(await setDefaultVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: true });
  expect((await getProfile(pool, a)).defaultVpa).toBe('ravi@okaxis');
  expect(await removeVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: true });
  expect((await getProfile(pool, a)).defaultVpa).toBeNull();
});

test('GSTIN is validated; empty clears it', async () => {
  const a = await newUser();
  expect(await saveGstin(pool, a, '29ABCDE1234F1Z5')).toEqual({ ok: true, gstin: '29ABCDE1234F1Z5' });
  expect((await getProfile(pool, a)).savedGstin).toBe('29ABCDE1234F1Z5');
  expect(await saveGstin(pool, a, '29ABCDE1234F1X5')).toEqual({ ok: false, reason: 'INVALID_GSTIN' });
  expect(await saveGstin(pool, a, '')).toEqual({ ok: true, gstin: null });
});
