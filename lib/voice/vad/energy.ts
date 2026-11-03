import type { VadFrameResult, VadProvider } from '../types';

export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  const value = Math.sqrt(sum / frame.length);
  return Math.min(1, Math.max(0, value));
}

export class EnergyVad implements VadProvider {
  readonly name = 'energy';
  private readonly threshold: number;

  constructor(opts: { threshold?: number } = {}) {
    this.threshold = opts.threshold ?? 0.02;
  }

  process(frame: Float32Array): VadFrameResult {
    const level = rms(frame);
    return { speech: level > this.threshold, level };
  }

  reset(): void {
    // Stateless: nothing to clear.
  }
}
