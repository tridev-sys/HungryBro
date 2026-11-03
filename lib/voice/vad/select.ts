import type { VadProvider } from '../types';
import { EnergyVad } from './energy';
import { SileroVad, type SileroModel } from './silero';

export function selectVad(opts: { preferSilero: boolean; loadModel?: () => Promise<SileroModel> }): VadProvider {
  if (opts.preferSilero && opts.loadModel) {
    return new SileroVad({ loadModel: opts.loadModel });
  }
  return new EnergyVad();
}
