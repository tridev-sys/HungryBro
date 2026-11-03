import type { CSSProperties } from 'react';

export type OrbState = 'idle' | 'listening' | 'speaking';

export interface VoiceOrbProps {
  state: OrbState;
  /** Audio level, 0..1. Clamped. Default 0. */
  level?: number;
  label?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 1.12;

export function VoiceOrb({ state, level = 0, label }: VoiceOrbProps) {
  const clamped = Math.min(1, Math.max(0, level));
  const scale = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * clamped;
  const text = label ?? (state === 'idle' ? 'TAP TO SPEAK' : 'VOICE AGENT ACTIVE');

  return (
    <div data-testid="voice-orb" data-state={state} className="flex flex-col items-center gap-3">
      <div
        data-testid="voice-orb-ring"
        className="motion-safe:animate-pulse relative flex h-[180px] w-[180px] items-center justify-center rounded-full bg-[conic-gradient(from_0deg,var(--color-orb-a),var(--color-orb-b),var(--color-orb-c),var(--color-orb-a))] transition-transform duration-300"
        style={{ '--orb-scale': String(scale), transform: 'scale(var(--orb-scale))' } as CSSProperties}
      >
        <div className="h-[156px] w-[156px] rounded-full bg-[var(--color-bg)]" />
      </div>
      <p className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)]">{text}</p>
    </div>
  );
}
