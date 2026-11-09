import { selectOtpProvider } from '@/lib/auth/otp-providers';

const SMTP = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'not-a-real-password',
  SMTP_FROM: 'noreply@example.test',
};
const MSG91 = { MSG91_AUTH_KEY: 'msg91-key', MSG91_TEMPLATE_ID: 'tpl-1' };

// The fixed dev code is chosen only when OTP_PROVIDER=dev is set. NODE_ENV alone never selects it.
test('development and test do not select the fixed dev code without OTP_PROVIDER=dev', () => {
  expect(() => selectOtpProvider({ NODE_ENV: 'development' })).toThrow(/No OTP provider/);
  expect(() => selectOtpProvider({ NODE_ENV: 'test' })).toThrow(/No OTP provider/);
  expect(selectOtpProvider({ NODE_ENV: 'test', ...SMTP }).name).toBe('email');
});

test('OTP_PROVIDER=dev selects the dev provider outside production', () => {
  expect(selectOtpProvider({ NODE_ENV: 'development', OTP_PROVIDER: 'dev' }).name).toBe('dev');
  expect(selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'dev', ...SMTP }).name).toBe('dev');
});

test('production with SMTP configured and no OTP_PROVIDER selects email', () => {
  expect(selectOtpProvider({ NODE_ENV: 'production', ...SMTP }).name).toBe('email');
});

test('production never selects MSG91 by default, even when its keys are present', () => {
  expect(() => selectOtpProvider({ NODE_ENV: 'production', ...MSG91 })).toThrow(/No OTP provider/);
  expect(() => selectOtpProvider({ NODE_ENV: 'production', ...MSG91, ...SMTP })).not.toThrow();
  expect(selectOtpProvider({ NODE_ENV: 'production', ...MSG91, ...SMTP }).name).toBe('email');
});

test('production with neither SMTP nor an explicit provider fails loudly', () => {
  expect(() => selectOtpProvider({ NODE_ENV: 'production' })).toThrow(/No OTP provider/);
});

test('MSG91 is chosen only when OTP_PROVIDER=msg91 is set explicitly', () => {
  expect(selectOtpProvider({ NODE_ENV: 'production', OTP_PROVIDER: 'msg91', ...MSG91, ...SMTP }).name).toBe('msg91');
  expect(selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'msg91', ...MSG91 }).name).toBe('msg91');
  expect(() => selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
});

test('OTP_PROVIDER=email requires SMTP_HOST and SMTP_FROM', () => {
  expect(selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'email', ...SMTP }).name).toBe('email');
  expect(() => selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'email' })).toThrow(/SMTP_HOST/);
  expect(() => selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'email', SMTP_HOST: 'h' })).toThrow(/SMTP_FROM/);
});

test('dev is still refused in production, and unknown values are rejected', () => {
  expect(() => selectOtpProvider({ OTP_PROVIDER: 'dev', NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  expect(() => selectOtpProvider({ NODE_ENV: 'test', OTP_PROVIDER: 'carrier-pigeon' })).toThrow(/Unknown OTP_PROVIDER/);
});
