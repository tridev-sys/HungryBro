'use client';

import { useActionState } from 'react';
import type { ProfileFormState } from '@/lib/profile/service';
import {
  addVpaAction, removeVpaAction, setDefaultVpaAction, saveGstinAction,
} from './actions';

export interface SettingsProfile {
  vpas: string[];
  defaultVpa: string | null;
  savedGstin: string | null;
}

const initial: ProfileFormState = {};

function Feedback({ state }: { state: ProfileFormState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="text-sm text-green-700">{state.message}</p>;
  return null;
}

export function SettingsForms({ profile }: { profile: SettingsProfile }) {
  const [addState, addAction, addPending] = useActionState(addVpaAction, initial);
  const [rowState, removeAction] = useActionState(removeVpaAction, initial);
  const [defaultState, setDefaultAction] = useActionState(setDefaultVpaAction, initial);
  const [gstinState, gstinAction, gstinPending] = useActionState(saveGstinAction, initial);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Saved UPI IDs</h2>
        {profile.vpas.length === 0 && <p className="text-sm text-neutral-600">No UPI IDs saved yet.</p>}
        <ul className="flex flex-col gap-2">
          {profile.vpas.map((vpa) => (
            <li key={vpa} className="flex items-center justify-between gap-2 rounded border border-neutral-200 p-3">
              <span className="font-mono text-sm">
                {vpa}
                {vpa === profile.defaultVpa && <span className="ml-2 text-xs text-neutral-500">(default)</span>}
              </span>
              <span className="flex gap-2">
                {vpa !== profile.defaultVpa && (
                  <form action={setDefaultAction}>
                    <input type="hidden" name="vpa" value={vpa} />
                    <button type="submit" className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm underline">Make default</button>
                  </form>
                )}
                <form action={removeAction}>
                  <input type="hidden" name="vpa" value={vpa} />
                  <button type="submit" className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-red-700 underline">Remove</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <Feedback state={rowState.message || rowState.error ? rowState : defaultState} />
        <form action={addAction} className="flex gap-2">
          <input
            name="vpa"
            placeholder="name@bank"
            autoComplete="off"
            required
            className="min-h-11 flex-1 rounded border border-neutral-300 px-3 py-2"
          />
          <button type="submit" disabled={addPending} className="min-h-11 rounded bg-neutral-900 px-4 py-2 text-white">
            Add
          </button>
        </form>
        <Feedback state={addState} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">GSTIN for invoices</h2>
        <form action={gstinAction} className="flex gap-2">
          <input
            name="gstin"
            defaultValue={profile.savedGstin ?? ''}
            placeholder="15-character GSTIN (optional)"
            autoComplete="off"
            className="min-h-11 flex-1 rounded border border-neutral-300 px-3 py-2 font-mono uppercase"
          />
          <button type="submit" disabled={gstinPending} className="min-h-11 rounded bg-neutral-900 px-4 py-2 text-white">
            Save
          </button>
        </form>
        <Feedback state={gstinState} />
      </section>
    </div>
  );
}
