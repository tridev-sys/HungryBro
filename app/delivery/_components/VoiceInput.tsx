'use client';

import { Mic, Send } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

// Typed input only. The mic is a placeholder until voice capture lands in Plan 04.
export default function VoiceInput({ value, onChange, onSubmit, disabled }: Props) {
  return (
    <form
      className="flex max-w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <button
        type="button"
        disabled
        aria-label="Voice input arrives in Plan 04"
        title="Voice input arrives in Plan 04"
        className="rounded-full border border-neutral-300 p-2 text-neutral-400"
      >
        <Mic size={18} aria-hidden="true" />
      </button>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Dinner for 3: Biryani & Kebab under 800, in 30 mins to Indiranagar"
        className="min-w-0 flex-1 basis-0 rounded-md border border-neutral-300 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
        maxLength={500}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40"
      >
        <Send size={16} aria-hidden="true" />
        Find kitchens
      </button>
    </form>
  );
}
