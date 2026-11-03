import { petpoojaAdapter } from './petpooja';
import { restroworksAdapter } from './restroworks';
import type { PosAdapter } from './types';

const adapters = new Map<string, PosAdapter>([
  [petpoojaAdapter.provider, petpoojaAdapter],
  [restroworksAdapter.provider, restroworksAdapter],
]);

export function getPosAdapter(provider: string): PosAdapter | undefined {
  return adapters.get(provider);
}
