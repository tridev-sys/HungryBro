import { randomBytes } from 'node:crypto';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { randomPhone } from '../helpers/db';

// Migration 013: a phone-only account can attach a verified email on the same row.
const pool = getAdminPool();
const freshEmail = (tag = 'claim') => `${tag}-${randomBytes(6).toString('hex')}@example.test`;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://food:change-me@localhost:5432/food_os';
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('otp_challenges has a purpose column defaulting to sign_in and a claim owner column', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, column_default, is_nullable FROM information_schema.columns
     WHERE table_name = 'otp_challenges' AND column_name IN ('purpose', 'claim_user_id') ORDER BY column_name`);
  expect(rows).toEqual([
    { column_name: 'claim_user_id', column_default: null, is_nullable: 'YES' },
    { column_name: 'purpose', column_default: "'sign_in'::text", is_nullable: 'NO' },
  ]);
});

test('an attach_email challenge must name its user, and a sign-in challenge must not', async () => {
  const { rows } = await pool.query(`INSERT INTO users (phone_number) VALUES ($1) RETURNING id`, [randomPhone()]);
  const userId = rows[0].id;
  await expect(pool.query(
    `INSERT INTO otp_challenges (email, code_hash, expires_at, purpose) VALUES ($1, 'h', NOW() + INTERVAL '5 minutes', 'attach_email')`,
    [freshEmail()],
  )).rejects.toThrow(/otp_challenges_claim_owner/);
  await expect(pool.query(
    `INSERT INTO otp_challenges (email, code_hash, expires_at, purpose, claim_user_id) VALUES ($1, 'h', NOW() + INTERVAL '5 minutes', 'sign_in', $2)`,
    [freshEmail(), userId],
  )).rejects.toThrow(/otp_challenges_claim_owner/);
});

test('app_attach_verified_email is granted to food_app only and is SECURITY DEFINER', async () => {
  const { rows } = await pool.query(`
    SELECT prosecdef, has_function_privilege('food_app', oid, 'EXECUTE') AS app_can,
           has_function_privilege('public', oid, 'EXECUTE') AS public_can
      FROM pg_proc WHERE proname = 'app_attach_verified_email'`);
  expect(rows).toEqual([{ prosecdef: true, app_can: true, public_can: false }]);
});
