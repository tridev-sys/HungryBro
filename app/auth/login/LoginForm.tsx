'use client';

import { useActionState } from 'react';
import type { LoginState } from '@/lib/auth/login';
import { sendOtpAction, verifyOtpAction } from './actions';

const initial: LoginState = { step: 'phone' };

export function LoginForm() {
  const [sendState, sendAction, sendPending] = useActionState(sendOtpAction, initial);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyOtpAction, initial);

  if (sendState.step === 'otp' && sendState.phone) {
    return (
      <form action={verifyAction} className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">Enter the 6-digit code sent to {sendState.phone}.</p>
        <input type="hidden" name="phone" value={sendState.phone} />
        <label className="flex flex-col gap-1 text-sm">
          Code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="rounded border border-neutral-300 px-3 py-2 text-lg tracking-widest"
          />
        </label>
        {verifyState.error && <p role="alert" className="text-sm text-red-700">{verifyState.error}</p>}
        <button type="submit" disabled={verifyPending} className="rounded bg-neutral-900 px-4 py-2 text-white">
          {verifyPending ? 'Checking...' : 'Verify and continue'}
        </button>
      </form>
    );
  }

  return (
    <form action={sendAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Mobile number (+91)
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required
          className="rounded border border-neutral-300 px-3 py-2 text-lg"
        />
      </label>
      {sendState.error && <p role="alert" className="text-sm text-red-700">{sendState.error}</p>}
      <button type="submit" disabled={sendPending} className="rounded bg-neutral-900 px-4 py-2 text-white">
        {sendPending ? 'Sending...' : 'Send code'}
      </button>
    </form>
  );
}
