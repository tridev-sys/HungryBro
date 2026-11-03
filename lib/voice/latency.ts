import type { Clock } from './types';

export const BUDGETS_MS = { audio_ingress: 200, nlu: 800, tts_first_audio: 150 } as const;

export type Stage = keyof typeof BUDGETS_MS;

export type TurnTiming = { [S in Stage as `${S}_ms`]?: number };

export class TurnTimer {
  private readonly clock: Clock;
  private readonly values: TurnTiming = {};

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async measure<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
    const start = this.clock.now();
    try {
      return await fn();
    } finally {
      this.record(stage, this.clock.now() - start);
    }
  }

  record(stage: Stage, ms: number): void {
    this.values[`${stage}_ms`] = ms;
  }

  snapshot(): TurnTiming {
    return { ...this.values };
  }
}

export function checkBudgets(
  t: TurnTiming,
): Array<{ stage: Stage; limitMs: number; actualMs: number }> {
  const violations: Array<{ stage: Stage; limitMs: number; actualMs: number }> = [];
  for (const stage of Object.keys(BUDGETS_MS) as Stage[]) {
    const actualMs = t[`${stage}_ms`];
    const limitMs = BUDGETS_MS[stage];
    if (actualMs !== undefined && actualMs >= limitMs) {
      violations.push({ stage, limitMs, actualMs });
    }
  }
  return violations;
}
