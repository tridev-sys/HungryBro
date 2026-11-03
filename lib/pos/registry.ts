import { petpoojaAdapter } from './petpooja';
import type { PosAdapter } from './types';

const adapters = new Map<string, PosAdapter>([[petpoojaAdapter.provider, petpoojaAdapter]]);

export function getPosAdapter(provider: string): PosAdapter | undefined {
  return adapters.get(provider);
}
