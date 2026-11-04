import { EmailOtpProvider, type MailMessage, type MailTransport } from '@/lib/auth/otp-providers';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { randomPhone } from '../helpers/db';

// A fake SMTP transport. It records messages and never opens a socket.
function fakeSmtp(behaviour: 'ok' | 'throw' = 'ok') {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    sendMail: async (msg: MailMessage) => {
      if (behaviour === 'throw') throw new Error('connect ECONNREFUSED smtp.example.test:587 secret-pass');
      sent.push(msg);
      return { messageId: 'test-message' };
    },
  };
  return { sent, transport };
}

const pool = getAdminPool();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('email provider sends a 6-digit code to the address through SMTP and reports ok', async () => {
  const smtp = fakeSmtp();
  const p = new EmailOtpProvider({ transport: smtp.transport, from: 'Food OS <noreply@example.test>' });
  const code = p.codeFor();
  expect(code).toMatch(/^\d{6}$/);

  expect(await p.send('member@example.test', code)).toEqual({ ok: true });
  expect(smtp.sent).toHaveLength(1);
  expect(smtp.sent[0].to).toBe('member@example.test');
  expect(smtp.sent[0].from).toBe('Food OS <noreply@example.test>');
  expect(smtp.sent[0].text).toContain(code);
});

test('a code sent by email verifies through the sign-in OTP path (DB round trip)', async () => {
  const smtp = fakeSmtp();
  const email = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  // The sign-in flow hands the provider the phone's E.164 value. This adapter maps it to a fixed
  // test mailbox, which is the only way to exercise the verify path without a phone-to-email link.
  const viaEmail = {
    name: 'email' as const,
    codeFor: () => email.codeFor(),
    send: (_destination: string, code: string) => email.send('member@example.test', code),
  };

  const phone = randomPhone();
  expect(await requestOtp(pool, viaEmail, phone)).toEqual({ ok: true, e164: phone });
  const emailed = smtp.sent[0].text.match(/\b(\d{6})\b/);
  expect(emailed).not.toBeNull();
  const code = emailed![1];

  expect(await verifyOtp(pool, phone, '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
  expect(await verifyOtp(pool, phone, code)).toEqual({ ok: true, e164: phone });
  expect(await verifyOtp(pool, phone, code)).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('email provider refuses a destination that is not an email address, without sending', async () => {
  const smtp = fakeSmtp();
  const p = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  expect(await p.send('+919876543210', '123456')).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
  expect(smtp.sent).toHaveLength(0);
});

test('SMTP failure is reported as OTP_SEND_FAILED and the error text (which may hold credentials) is not returned', async () => {
  const smtp = fakeSmtp('throw');
  const p = new EmailOtpProvider({ transport: smtp.transport, from: 'noreply@example.test' });
  const result = await p.send('member@example.test', '123456');
  expect(result).toEqual({ ok: false, code: 'OTP_SEND_FAILED' });
  expect(JSON.stringify(result)).not.toContain('secret-pass');
});
