import { randomInt } from 'node:crypto';

export const DEV_OTP_CODE = '123456';
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpSendResult = { ok: true } | { ok: false; code: 'OTP_SEND_FAILED' };

export interface OtpProvider {
  readonly name: 'msg91' | 'dev';
  codeFor(): string;
  send(e164: string, code: string): Promise<OtpSendResult>;
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

export function selectOtpProvider(env: NodeJS.ProcessEnv): OtpProvider {
  const production = env.NODE_ENV === 'production';
  const mode = env.OTP_PROVIDER;

  if (mode === 'dev') {
    if (production) throw new Error('OTP_PROVIDER=dev is not allowed in production');
    return new DevFixedCodeProvider();
  }
  if (mode === 'msg91' || (!mode && production)) {
    const authKey = env.MSG91_AUTH_KEY;
    const templateId = env.MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) {
      throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for the msg91 OTP provider');
    }
    return new Msg91OtpProvider({ authKey, templateId });
  }
  if (!mode) return new DevFixedCodeProvider();
  throw new Error(`Unknown OTP_PROVIDER: ${mode}`);
}
