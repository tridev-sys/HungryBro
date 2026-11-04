import { randomBytes } from 'node:crypto';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { EmailOtpProvider, DevFixedCodeProvider, type MailMessage, type MailTransport, type OtpProvider } from '@/lib/auth/otp-providers';
import { completeLogin } from '@/lib/auth/login';
import { lookupUserByEmail, lookupUserByPhone } from '@/lib/auth/sign-in';
import { requestEmailClaim, confirmEmailClaim } from '@/lib/auth/email-claim';
import { randomPhone } from '../helpers/db';

function fakeSmtp() {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    sendMail: async (msg: MailMessage) => { sent.push(msg); return { messageId: 'test' }; },
  };
  return { sent, transport };
}
const codeFrom = (msg: MailMessage) => msg.text.match(/\b(\d{6})\b/)![1];
const freshEmail = (tag = 'claim') => `${tag}-${randomBytes(6).toString('hex')}@example.test`;

// A stand-in for the MSG91 SMS provider. It never sends anything.
const msg91Fake: OtpProvider = {
  name: 'msg91',
  codeFor: () => '123456',
  send: async () => ({ ok: true }),
};

const pool = getAdminPool();

async function phoneOnlyUser(): Promise<{ id: string; phone: string }> {
  const phone = randomPhone();
  const { rows } = await pool.query(`INSERT INTO users (phone_number) VALUES ($1) RETURNING id`, [phone]);
  return { id: rows[0].id, phone };
}

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

describe('phone sign-in when SMS is off', () => {
  test('a phone identifier is refused by the email provider before any challenge is written', async () => {
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const phone = randomPhone();
    expect(await requestOtp(pool, provider, phone)).toEqual({ ok: false, reason: 'PHONE_UNAVAILABLE' });
    expect(smtp.sent).toHaveLength(0);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM otp_challenges WHERE phone_e164 = $1`, [phone]);
    expect(rows[0].n).toBe(0);
  });

  test('the MSG91 path still accepts a phone identifier, and the dev provider is unchanged', async () => {
    const phone = randomPhone();
    expect(await requestOtp(pool, msg91Fake, phone)).toEqual({ ok: true, e164: phone });
    expect(await requestOtp(pool, new DevFixedCodeProvider(), randomPhone())).toMatchObject({ ok: true });
  });

  test('an email sign-in for a phone-only account creates a separate row and leaves the phone row unchanged', async () => {
    const user = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const email = freshEmail('new');
    expect(await requestOtp(pool, provider, email)).toEqual({ ok: true, email });
    const result = await completeLogin(pool, email, codeFrom(smtp.sent[0]));
    expect(result).toMatchObject({ ok: true });
    const created = await lookupUserByEmail(pool, email);
    expect(created).not.toBeNull();
    expect(created!.id).not.toBe(user.id);
    expect(await lookupUserByPhone(pool, user.phone)).toMatchObject({ id: user.id });
  });
});

describe('attaching a verified email to an existing account', () => {
  test('a phone-only user gets a verified email on the same row, after a code proves the address', async () => {
    const user = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const email = freshEmail();
    expect(await requestEmailClaim(pool, provider, user.id, `  ${email.toUpperCase()} `))
      .toEqual({ ok: true, email });
    expect(smtp.sent[0].to).toBe(email);
    expect(await confirmEmailClaim(pool, user.id, email, codeFrom(smtp.sent[0])))
      .toEqual({ ok: true, email });

    const { rows } = await pool.query(`SELECT id, email, phone_number FROM users WHERE id = $1`, [user.id]);
    expect(rows).toEqual([{ id: user.id, email, phone_number: user.phone }]);
    expect(await lookupUserByEmail(pool, email)).toMatchObject({ id: user.id });
  });

  test('a wrong code attaches nothing', async () => {
    const user = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const email = freshEmail();
    await requestEmailClaim(pool, provider, user.id, email);
    expect(await confirmEmailClaim(pool, user.id, email, '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [user.id]);
    expect(rows[0].email).toBeNull();
  });

  test('a claim code issued to one user cannot attach the email to another user', async () => {
    const owner = await phoneOnlyUser();
    const other = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const email = freshEmail();
    await requestEmailClaim(pool, provider, owner.id, email);
    expect(await confirmEmailClaim(pool, other.id, email, codeFrom(smtp.sent[0])))
      .toEqual({ ok: false, reason: 'NOT_VERIFIED' });
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [other.id]);
    expect(rows[0].email).toBeNull();
  });

  test('a sign-in code cannot attach an email to an account', async () => {
    const user = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    const email = freshEmail();
    await requestOtp(pool, provider, email);
    expect(await verifyOtp(pool, email, codeFrom(smtp.sent[0]))).toEqual({ ok: true, email });
    // No claim was requested, and the sign-in challenge is already spent, so there is nothing to confirm.
    expect(await confirmEmailClaim(pool, user.id, email, codeFrom(smtp.sent[0])))
      .toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [user.id]);
    expect(rows[0].email).toBeNull();
  });

  test('an account that already has an email cannot add another, and no code is sent', async () => {
    const email = freshEmail('has');
    const { rows } = await pool.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [email]);
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    expect(await requestEmailClaim(pool, provider, rows[0].id, freshEmail())).toEqual({ ok: false, reason: 'ALREADY_HAS_EMAIL' });
    expect(smtp.sent).toHaveLength(0);
  });

  test('a claim without a signed-in user is refused and writes nothing', async () => {
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    await expect(requestEmailClaim(pool, provider, '', freshEmail())).rejects.toThrow(/NOT_SIGNED_IN/);
    expect(smtp.sent).toHaveLength(0);
  });

  test('an address already used by another account is refused after a valid code', async () => {
    const taken = freshEmail('taken');
    await pool.query(`INSERT INTO users (email) VALUES ($1)`, [taken]);
    const user = await phoneOnlyUser();
    const smtp = fakeSmtp();
    const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
    await requestEmailClaim(pool, provider, user.id, taken.toUpperCase());
    expect(await confirmEmailClaim(pool, user.id, taken, codeFrom(smtp.sent[0])))
      .toEqual({ ok: false, reason: 'EMAIL_TAKEN' });
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [user.id]);
    expect(rows[0].email).toBeNull();
  });

  test('a claim is limited to 3 codes an hour per address, like sign-in', async () => {
    const user = await phoneOnlyUser();
    const provider = new DevFixedCodeProvider();
    const email = freshEmail('limit');
    for (let i = 0; i < 3; i++) expect(await requestEmailClaim(pool, provider, user.id, email)).toEqual({ ok: true, email });
    expect(await requestEmailClaim(pool, provider, user.id, email)).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  });
});
