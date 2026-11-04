import { randomBytes } from 'node:crypto';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { EmailOtpProvider, DevFixedCodeProvider, type MailMessage, type MailTransport } from '@/lib/auth/otp-providers';
import { sendOtpForIdentifier, completeLogin } from '@/lib/auth/login';
import { lookupUserByEmail, createUserAfterEmailOtp } from '@/lib/auth/sign-in';
import { randomPhone } from '../helpers/db';

// A fake SMTP transport: records messages, never opens a socket. The message text carries the code,
// so tests read it from there, as a person would read the email.
function fakeSmtp(behaviour: 'ok' | 'throw' = 'ok') {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    sendMail: async (msg: MailMessage) => {
      if (behaviour === 'throw') throw new Error('auth failed for user smtp-login secret-pass');
      sent.push(msg);
      return { messageId: 'test' };
    },
  };
  return { sent, transport };
}

const codeFrom = (msg: MailMessage) => msg.text.match(/\b(\d{6})\b/)![1];
const freshEmail = () => `diner-${randomBytes(6).toString('hex')}@example.test`;

const pool = getAdminPool();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('an email identifier sends the code to the normalised address and returns the email, not a phone', async () => {
  const smtp = fakeSmtp();
  const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  const email = freshEmail();
  expect(await requestOtp(pool, provider, `  ${email.toUpperCase()} `)).toEqual({ ok: true, email });
  expect(smtp.sent).toHaveLength(1);
  expect(smtp.sent[0].to).toBe(email);
});

test('an email code verifies once, case-insensitively, and then the challenge is spent', async () => {
  const smtp = fakeSmtp();
  const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  const email = freshEmail();
  await requestOtp(pool, provider, email);
  const code = codeFrom(smtp.sent[0]);
  expect(await verifyOtp(pool, email.toUpperCase(), '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
  expect(await verifyOtp(pool, email.toUpperCase(), code)).toEqual({ ok: true, email });
  expect(await verifyOtp(pool, email, code)).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('an email identifier is limited to 3 challenges an hour, like a phone', async () => {
  const provider = new DevFixedCodeProvider();
  const email = freshEmail();
  for (let i = 0; i < 3; i++) expect(await requestOtp(pool, provider, email)).toEqual({ ok: true, email });
  expect(await requestOtp(pool, provider, email)).toEqual({ ok: false, reason: 'RATE_LIMITED' });
});

test('a malformed email is INVALID_EMAIL and creates no challenge', async () => {
  const provider = new DevFixedCodeProvider();
  expect(await requestOtp(pool, provider, 'bad@')).toEqual({ ok: false, reason: 'INVALID_EMAIL' });
  const { rowCount } = await pool.query(`SELECT 1 FROM otp_challenges WHERE email = 'bad@'`);
  expect(rowCount).toBe(0);
});

test('SMTP failure is SEND_FAILED and the SMTP error text is not returned', async () => {
  const smtp = fakeSmtp('throw');
  const provider = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  const result = await requestOtp(pool, provider, freshEmail());
  expect(result).toEqual({ ok: false, reason: 'SEND_FAILED' });
  expect(JSON.stringify(result)).not.toContain('secret-pass');
});

test('an email identifier is never handed to an SMS provider', async () => {
  let sent = false;
  const sms = {
    name: 'msg91' as const,
    codeFor: () => '123456',
    send: async () => { sent = true; return { ok: true as const }; },
  };
  const email = freshEmail();
  expect(await requestOtp(pool, sms, email)).toEqual({ ok: false, reason: 'SEND_FAILED' });
  expect(sent).toBe(false);
  const { rowCount } = await pool.query(`SELECT 1 FROM otp_challenges WHERE email = $1`, [email]);
  expect(rowCount).toBe(0);
});

test('sign-in by email creates one email-only user, then signs the same user in again', async () => {
  const provider = new DevFixedCodeProvider();
  const email = freshEmail();
  expect(await sendOtpForIdentifier(pool, provider, email)).toEqual({ step: 'otp', email });

  const first = await completeLogin(pool, email, '123456');
  if (!first.ok || !('token' in first)) throw new Error('email sign-in failed');
  await sendOtpForIdentifier(pool, provider, email.toUpperCase());
  const second = await completeLogin(pool, email.toUpperCase(), '123456');
  if (!second.ok || !('token' in second)) throw new Error('second email sign-in failed');
  expect(second.userId).toBe(first.userId);

  const { rows } = await pool.query('SELECT email, phone_number FROM users WHERE id = $1', [first.userId]);
  expect(rows).toEqual([{ email, phone_number: null }]);
});

test('email and phone users are separate accounts; each identifier resolves to one user', async () => {
  const provider = new DevFixedCodeProvider();
  const phone = randomPhone();
  const email = freshEmail();
  await sendOtpForIdentifier(pool, provider, phone);
  const byPhone = await completeLogin(pool, phone, '123456');
  await sendOtpForIdentifier(pool, provider, email);
  const byEmail = await completeLogin(pool, email, '123456');
  if (!byPhone.ok || !byEmail.ok) throw new Error('sign-in failed');
  expect(byPhone.userId).not.toBe(byEmail.userId);
  expect((await lookupUserByEmail(pool, email))?.id).toBe(byEmail.userId);
});

test('the sign-in lookup and create helpers never return or create a user for an unverified email', async () => {
  const email = freshEmail();
  expect(await lookupUserByEmail(pool, email)).toBeNull();
  await expect(createUserAfterEmailOtp(pool, email)).rejects.toThrow(/OTP_NOT_VERIFIED/);
});
