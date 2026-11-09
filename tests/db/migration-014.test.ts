import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { DevFixedCodeProvider } from '@/lib/auth/otp-providers';
import { ensureAppLogin, randomPhone } from '../helpers/db';

// Migration 014: otp_challenges is written only through SECURITY DEFINER functions.
const admin = getAdminPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(admin);
  await ensureAppLogin(admin);
});
afterAll(async () => { await admin.end(); });

test('food_app and food_sync hold no table privileges on otp_challenges', async () => {
  const { rows } = await admin.query<{ role: string; priv: string; allowed: boolean }>(`
    SELECT r.role, p.priv, has_table_privilege(r.role, 'otp_challenges', p.priv) AS allowed
      FROM (VALUES ('food_app'), ('food_sync')) AS r(role)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)`);
  expect(rows.filter((r) => r.allowed)).toEqual([]);
});

test('the runtime role cannot UPDATE or DELETE otp_challenges directly', async () => {
  const phone = randomPhone();
  await requestOtp(admin, dev, phone);
  const app = await getPool();
  await expect(app.query(`UPDATE otp_challenges SET attempts = 0 WHERE phone_e164 = $1`, [phone]))
    .rejects.toThrow(/permission denied/);
  await expect(app.query(`DELETE FROM otp_challenges WHERE phone_e164 = $1`, [phone]))
    .rejects.toThrow(/permission denied/);
  await expect(app.query(`UPDATE otp_challenges SET consumed_at = NOW() WHERE phone_e164 = $1`, [phone]))
    .rejects.toThrow(/permission denied/);
});

test('the sign-in code flow still works through the runtime role (issue, claim, consume)', async () => {
  const app = await getPool();
  const phone = randomPhone();
  expect(await requestOtp(app, dev, phone)).toEqual({ ok: true, e164: phone });
  expect(await verifyOtp(app, phone, '123456')).toEqual({ ok: true, e164: phone });
  expect(await verifyOtp(app, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('a wrong code is counted by the runtime role and the attempt cap still applies', async () => {
  const app = await getPool();
  const phone = randomPhone();
  await requestOtp(app, dev, phone);
  for (let i = 0; i < 5; i++) {
    expect(await verifyOtp(app, phone, '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
  }
  expect(await verifyOtp(app, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('a claim that waits on a concurrent attempt re-checks the attempt cap after the lock (race)', async () => {
  const app = await getPool();
  const phone = randomPhone();
  await requestOtp(admin, dev, phone);

  // The holder commits attempts = 5 (the cap) only after the claim has picked its row, so the claim
  // waits on the row lock. A claim that re-checks the cap after the lock must refuse.
  const holder = await admin.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(`UPDATE otp_challenges SET attempts = 5 WHERE phone_e164 = $1`, [phone]);
    const pending = verifyOtp(app, phone, '000000');
    for (let i = 0; i < 100; i++) {
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%app_claim_otp_challenge%'`);
      if (rows[0].n > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await holder.query('COMMIT');
    expect(await pending).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
  } finally {
    holder.release();
  }
  const { rows } = await admin.query(`SELECT attempts FROM otp_challenges WHERE phone_e164 = $1`, [phone]);
  expect(rows[0].attempts).toBe(5);
});

test('ten concurrent wrong codes never push the attempt count past the cap', async () => {
  const app = await getPool();
  const phone = randomPhone();
  await requestOtp(admin, dev, phone);
  const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(app, phone, '000000')));
  expect(results.filter((r) => r.ok === false && r.reason === 'WRONG_CODE').length).toBeLessThanOrEqual(5);
  const { rows } = await admin.query(`SELECT attempts FROM otp_challenges WHERE phone_e164 = $1`, [phone]);
  expect(rows[0].attempts).toBeLessThanOrEqual(5);
});
