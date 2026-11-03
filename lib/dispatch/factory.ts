import { DunzoAdapter } from './providers/dunzo';
import { RapidoAdapter } from './providers/rapido';
import { ShadowfaxAdapter } from './providers/shadowfax';
import type { DispatchAdapter, SandboxConfig, ThreePlProvider } from './types';

// Live dispatch is not enabled in Plan 06. Only sandbox mode can be constructed here.
export function createDispatchAdapter(provider: ThreePlProvider, cfg: SandboxConfig): DispatchAdapter {
  if (cfg.mode === 'live') throw new Error('live dispatch is not enabled in Plan 06');
  switch (provider) {
    case 'shadowfax':
      return new ShadowfaxAdapter(cfg);
    case 'rapido':
      return new RapidoAdapter(cfg);
    case 'dunzo':
      return new DunzoAdapter(cfg);
  }
}
