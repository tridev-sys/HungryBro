import { randomBytes } from 'node:crypto';
import { getAdminPool, runMigrations, asRole } from '@/lib/db/client';
import { randomPhone } from '../helpers/db';

// Migration 012: email identity. Each test uses a fresh address so runs never collide.
const pool = getAdminPool();
const freshEmail = (tag = 'user') => `${tag}-${randomBytes(6).toString('hex')}@example.test`;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://food:change-me@localhost:5432/food_os';
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('users.phone_number is nullable and users.email exists', async () => {
  const { rows } = await pool.query(`
    SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name = 'users' AND column_name IN ('phone_number', 'email') ORDER BY column_name`);
  expect(rows).toEqual([
    { column_name: 'email', is_nullable: 'YES' },
    { column_name: 'phone_number', is_nullable: 'YES' },
  ]);
});

test('a user needs at least one identifier', async () => {
  await expect(pool.query(`INSERT INTO users (role) VALUES ('diner')`))
    .rejects.toThrow(/users_has_identifier/);
});

test('an email-only user is accepted and a phone-only user still is', async () => {
  const email = freshEmail('only');
  const { rows } = await pool.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [email]);
  expect(rows[0].id).toBeTruthy();
  const phone = randomPhone();
  await pool.query(`INSERT INTO users (phone_number) VALUES ($1)`, [phone]);
});

test('stored email must already be normalised (trimmed, lowercase)', async () => {
  await expect(pool.query(`INSERT INTO users (email) VALUES ($1)`, [' Mixed@Example.test']))
    .rejects.toThrow(/users_email_normalised/);
  await expect(pool.query(`INSERT INTO users (email) VALUES ($1)`, ['not-an-email']))
    .rejects.toThrow(/users_email_normalised/);
});

test('email is unique case-insensitively (unique index on lower(email))', async () => {
  const email = freshEmail('dup');
  await pool.query(`INSERT INTO users (email) VALUES ($1)`, [email]);
  await expect(pool.query(`INSERT INTO users (email) VALUES ($1)`, [email]))
    .rejects.toThrow(/users_email_lower_key/);
});

test('phone stays unique and rows that have a phone keep it', async () => {
  const phone = randomPhone();
  await pool.query(`INSERT INTO users (phone_number) VALUES ($1)`, [phone]);
  await expect(pool.query(`INSERT INTO users (phone_number) VALUES ($1)`, [phone]))
    .rejects.toThrow(/duplicate key/);
});

test('otp_challenges takes exactly one identifier', async () => {
  await expect(pool.query(
    `INSERT INTO otp_challenges (code_hash, expires_at) VALUES ('h', NOW() + INTERVAL '5 minutes')`))
    .rejects.toThrow(/otp_challenges_one_identifier/);
  await expect(pool.query(
    `INSERT INTO otp_challenges (phone_e164, email, code_hash, expires_at)
     VALUES ('+919000000001', 'both@example.test', 'h', NOW() + INTERVAL '5 minutes')`))
    .rejects.toThrow(/otp_challenges_one_identifier/);
});

test('app_lookup_user_by_email and app_create_user_after_email_otp are SECURITY DEFINER, owned by food_admin, with a fixed search_path', async () => {
  const { rows } = await pool.query(`
    SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig
    FROM pg_proc WHERE proname IN ('app_lookup_user_by_email', 'app_create_user_after_email_otp')`);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.prosecdef).toBe(true);
    expect(r.owner).toBe('food_admin');
    expect(r.proconfig.join(' ')).toMatch(/search_path=/);
  }
});

test('app_lookup_user_by_email is case-insensitive, returns no row for an unknown address, and creates nothing', async () => {
  const email = freshEmail('lookup');
  await pool.query(`INSERT INTO users (email) VALUES ($1)`, [email]);
  const [hit, miss] = await asRole(pool, null, async (c) => [
    (await c.query('SELECT id FROM app_lookup_user_by_email($1)', [email.toUpperCase()])).rows,
    (await c.query('SELECT id FROM app_lookup_user_by_email($1)', [freshEmail('nobody')])).rows,
  ]);
  expect(hit).toHaveLength(1);
  expect(miss).toEqual([]);
});

test('app_create_user_after_email_otp is rejected without a verified challenge and creates no user', async () => {
  const email = freshEmail('unverified');
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_email_otp($1)', [email])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  await pool.query(
    `INSERT INTO otp_challenges (email, code_hash, expires_at) VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes')`,
    [email]);
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_email_otp($1)', [email])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  expect(rowCount).toBe(0);
});

test('app_create_user_after_email_otp with a verified challenge creates exactly one user, idempotently', async () => {
  const email = freshEmail('verified');
  await pool.query(
    `INSERT INTO otp_challenges (email, code_hash, expires_at, consumed_at)
     VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes', NOW())`,
    [email]);
  const [first, second] = await asRole(pool, null, async (c) => [
    (await c.query('SELECT id, role, phone_number FROM app_create_user_after_email_otp($1)', [email])).rows[0],
    (await c.query('SELECT id FROM app_create_user_after_email_otp($1)', [email])).rows[0],
  ]);
  expect(first.role).toBe('diner');
  expect(first.phone_number).toBeNull();
  expect(second.id).toBe(first.id);
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  expect(rows).toHaveLength(1);
});

test('email challenges are limited per address: at most 3 in an hour', async () => {
  const email = freshEmail('limit');
  const issued = await asRole(pool, null, async (c) => {
    const out: Array<string | null> = [];
    for (let i = 0; i < 4; i++) {
      out.push((await c.query('SELECT app_issue_otp_challenge_email($1, $2) AS id', [email, 'h'])).rows[0].id);
    }
    return out;
  });
  expect(issued.slice(0, 3).every((id) => typeof id === 'string')).toBe(true);
  expect(issued[3]).toBeNull();
});
