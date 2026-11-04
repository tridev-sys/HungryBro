'use client';

import { useActionState } from 'react';
import type { LoginState } from '@/lib/auth/login';
import { sendOtpAction, verifyOtpAction, verifyTotpAction } from './actions';

const initial: LoginState = { step: 'phone' };

export function LoginForm() {
  const [sendState, sendAction, sendPending] = useActionState(sendOtpAction, initial);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyOtpAction, initial);
  const [totpState, totpAction, totpPending] = useActionState(verifyTotpAction, initial);

  if (verifyState.step === 'totp') {
    return (
      <form action={totpAction} className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
        <label className="flex flex-col gap-1 text-sm">
          Authenticator or recovery code
          <input
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            required
            className="min-h-11 rounded border border-neutral-300 px-3 py-2 text-lg tracking-widest"
          />
        </label>
        {totpState.error && <p role="alert" className="text-sm text-red-700">{totpState.error}</p>}
        <button type="submit" disabled={totpPending} className="min-h-11 rounded bg-neutral-900 px-4 py-2 text-white">
          {totpPending ? 'Checking...' : 'Verify and sign in'}
        </button>
      </form>
    );
  }

  const sentTo = sendState.phone ?? sendState.email;
  if (sendState.step === 'otp' && sentTo) {
    return (
      <form action={verifyAction} className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">Enter the 6-digit code sent to {sentTo}.</p>
        <input type="hidden" name="identifier" value={sentTo} />
        <label className="flex flex-col gap-1 text-sm">
          Code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="min-h-11 rounded border border-neutral-300 px-3 py-2 text-lg tracking-widest"
          />
        </label>
        {verifyState.error && <p role="alert" className="text-sm text-red-700">{verifyState.error}</p>}
        <button type="submit" disabled={verifyPending} className="min-h-11 rounded bg-neutral-900 px-4 py-2 text-white">
          {verifyPending ? 'Checking...' : 'Verify and continue'}
        </button>
      </form>
    );
  }

  return (
    <form action={sendAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Mobile number (+91) or email
        <input
          name="identifier"
          type="text"
          inputMode="email"
          autoComplete="username"
          spellCheck={false}
          required
          className="min-h-11 rounded border border-neutral-300 px-3 py-2 text-lg"
        />
      </label>
      {sendState.error && <p role="alert" className="text-sm text-red-700">{sendState.error}</p>}
      <button type="submit" disabled={sendPending} className="min-h-11 rounded bg-neutral-900 px-4 py-2 text-white">
        {sendPending ? 'Sending...' : 'Send code'}
      </button>
    </form>
  );
}
