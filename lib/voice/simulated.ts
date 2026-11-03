import { round2 } from '@/lib/pricing';

/** Stand-in audio level for the orb until Plan 04 streams real audio. 0 while the mic is off. */
export function simulatedLevel(tMs: number, micOn: boolean): number {
  if (!micOn) return 0;
  const level = round2(0.5 + 0.5 * Math.sin(tMs / 250));
  return Math.min(1, Math.max(0, level));
}

/** Scripted lines for the transcript. No voice data is sent anywhere. */
export const SIMULATED_TRANSCRIPT: Array<{ speaker: 'agent' | 'diner'; text: string }> = [
  { speaker: 'agent', text: 'Welcome. What would you like to start with?' },
  { speaker: 'diner', text: 'Two lassis and a paneer tikka, please.' },
  { speaker: 'agent', text: 'Added. Would you like to split the bill?' },
];
