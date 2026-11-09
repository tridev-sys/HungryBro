import { randomInt } from 'node:crypto';
import nodemailer from 'nodemailer';

export const DEV_OTP_CODE = '123456';
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpSendResult = { ok: true } | { ok: false; code: 'OTP_SEND_FAILED' };

// The destination is whatever the provider delivers to: an E.164 number for MSG91, an email address
// for the email provider. The dev provider ignores it.
export interface OtpProvider {
  readonly name: 'email' | 'msg91' | 'dev';
  codeFor(): string;
  send(destination: string, code: string): Promise<OtpSendResult>;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The part of a nodemailer transporter the provider uses. Tests pass a fake. */
export interface MailTransport {
  sendMail(msg: MailMessage): Promise<unknown>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export interface EmailOtpOptions {
  transport: MailTransport;
  from: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends the sign-in code by email through standard SMTP (nodemailer, MIT). A failure never carries
 * the recipient, the code, or the SMTP error text, because that text can include the server name or login.
 */
export class EmailOtpProvider implements OtpProvider {
  readonly name = 'email' as const;
  private readonly opts: EmailOtpOptions;

  constructor(opts: EmailOtpOptions) {
    this.opts = opts;
  }

  codeFor(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async send(to: string, code: string): Promise<OtpSendResult> {
    if (!EMAIL_RE.test(to)) return { ok: false, code: 'OTP_SEND_FAILED' };
    try {
      await this.opts.transport.sendMail({
        from: this.opts.from,
        to,
        subject: 'Your Food OS sign-in code',
        text: `Your Food OS sign-in code is ${code}. It expires in 5 minutes. If you did not ask for it, ignore this email.`,
      });
    } catch {
      return { ok: false, code: 'OTP_SEND_FAILED' };
    }
    return { ok: true };
  }
}

/** Standard SMTP transport. No connection is opened until the first send. */
export function createSmtpTransport(cfg: SmtpConfig): MailTransport {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
  });
}

export interface Msg91Options {
  authKey: string;
  templateId: string;
  fetchImpl?: typeof fetch;
}

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: endpoint URL, authkey header name, and body fields.
const MSG91_URL = 'https://control.msg91.com/api/v5/otp';

export class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91' as const;
  private readonly opts: Msg91Options;

  constructor(opts: Msg91Options) {
    this.opts = opts;
  }

  codeFor(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  // MSG91 can answer HTTP 200 with a body of type "error", so the body is checked too.
  // A failure never carries the phone number, the code, or any part of the response body.
  async send(e164: string, code: string): Promise<OtpSendResult> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(MSG91_URL, {
        method: 'POST',
        headers: { authkey: this.opts.authKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: this.opts.templateId,
          mobile: e164.replace(/^\+/, ''),
          otp: code,
        }),
      });
    } catch {
      return { ok: false, code: 'OTP_SEND_FAILED' };
    }
    if (!res.ok) return { ok: false, code: 'OTP_SEND_FAILED' };

    let body: unknown;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return { ok: false, code: 'OTP_SEND_FAILED' };
    }
    const type = typeof body === 'object' && body !== null && 'type' in body ? (body as { type: unknown }).type : undefined;
    if (typeof type === 'string' && type.toLowerCase() === 'error') {
      return { ok: false, code: 'OTP_SEND_FAILED' };
    }
    return { ok: true };
  }
}

export class DevFixedCodeProvider implements OtpProvider {
  readonly name = 'dev' as const;

  codeFor(): string {
    return DEV_OTP_CODE;
  }

  async send(): Promise<OtpSendResult> {
    // No SMS in development. The code is always DEV_OTP_CODE.
    return { ok: true };
  }
}

function smtpConfigFrom(env: NodeJS.ProcessEnv): SmtpConfig {
  const host = env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST is required for the email OTP provider');
  const from = env.SMTP_FROM;
  if (!from) throw new Error('SMTP_FROM is required for the email OTP provider');
  const port = Number(env.SMTP_PORT || '587');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('SMTP_PORT must be a port number');
  return { host, port, user: env.SMTP_USER || undefined, pass: env.SMTP_PASS || undefined, from };
}

function emailProviderFrom(env: NodeJS.ProcessEnv): EmailOtpProvider {
  const cfg = smtpConfigFrom(env);
  return new EmailOtpProvider({ transport: createSmtpTransport(cfg), from: cfg.from });
}

function msg91ProviderFrom(env: NodeJS.ProcessEnv): Msg91OtpProvider {
  const authKey = env.MSG91_AUTH_KEY;
  const templateId = env.MSG91_TEMPLATE_ID;
  if (!authKey || !templateId) {
    throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for the msg91 OTP provider');
  }
  return new Msg91OtpProvider({ authKey, templateId });
}

/**
 * Chooses the OTP provider from OTP_PROVIDER (email | msg91 | dev). Unset: email when SMTP_HOST is set, else refused.
 * Unset: dev in development and test; email in production when SMTP_HOST is set; otherwise an error.
 * MSG91 is never chosen unless OTP_PROVIDER=msg91 is set. The dev provider is refused in production.
 */
export function selectOtpProvider(env: NodeJS.ProcessEnv): OtpProvider {
  const production = env.NODE_ENV === 'production';
  const mode = env.OTP_PROVIDER || undefined;

  if (mode === 'dev') {
    if (production) throw new Error('OTP_PROVIDER=dev is not allowed in production');
    return new DevFixedCodeProvider();
  }
  if (mode === 'email') return emailProviderFrom(env);
  if (mode === 'msg91') return msg91ProviderFrom(env);
  if (mode) throw new Error(`Unknown OTP_PROVIDER: ${mode}`);

  // The dev provider (fixed code) is never implied by NODE_ENV. It needs OTP_PROVIDER=dev, handled above.
  if (env.SMTP_HOST) return emailProviderFrom(env);
  throw new Error('No OTP provider configured: set SMTP_HOST and SMTP_FROM, or OTP_PROVIDER');
}
