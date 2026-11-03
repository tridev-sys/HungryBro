import type { VadFrameResult, VadProvider } from '../types';
import { rms } from './energy';

export interface SileroModel {
  process(frame: Float32Array): Promise<number>;
}

// Browser-only wrapper. Speech comes from the most recent model probability; level is always RMS.
export class SileroVad implements VadProvider {
  readonly name = 'silero';
  private readonly loadModel: () => Promise<SileroModel>;
  private readonly threshold: number;
  private model: SileroModel | null = null;
  private loading: Promise<SileroModel> | null = null;
  private lastProbability = 0;

  constructor(opts: { loadModel: () => Promise<SileroModel>; threshold?: number }) {
    this.loadModel = opts.loadModel;
    this.threshold = opts.threshold ?? 0.5;
  }

  // Loads the model once, then primes the probability with one silent frame so the first
  // process() call has a real value.
  async ready(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadModel().then((m) => {
        this.model = m;
        return m;
      });
    }
    const model = await this.loading;
    this.lastProbability = await model.process(new Float32Array(160));
  }

  // Synchronous per VadProvider. Returns the latest probability and schedules inference
  // on this frame for the next call. Before the model loads, it reports level only.
  process(frame: Float32Array): VadFrameResult {
    const level = rms(frame);
    if (!this.model) {
      return { speech: false, level };
    }
    const model = this.model;
    model.process(frame).then(
      (p) => {
        this.lastProbability = p;
      },
      () => {
        this.lastProbability = 0;
      },
    );
    return { speech: this.lastProbability > this.threshold, level };
  }

  reset(): void {
    this.lastProbability = 0;
  }
}
