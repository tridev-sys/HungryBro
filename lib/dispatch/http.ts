import type { DispatchStatus, SandboxConfig } from './types';

// Shared request helper for the 3PL sandbox adapters. Throws on non-2xx without echoing the body.
export async function providerRequest(
  cfg: SandboxConfig,
  label: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${label} responded with status ${res.status}`);
  const text = await res.text();
  return text.length > 0 ? JSON.parse(text) : undefined;
}

// Maps a provider state string to DispatchStatus. Unknown states map to 'created'.
export function normalizeStatus(raw: string): DispatchStatus {
  switch (raw.trim().toLowerCase().replace(/[\s-]+/g, '_')) {
    case 'assigned':
      return 'assigned';
    case 'picked_up':
    case 'pickedup':
      return 'picked_up';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      return 'created';
  }
}

export function assertSandbox(cfg: SandboxConfig): void {
  if (cfg.mode !== 'sandbox') throw new Error('live dispatch is not enabled in Plan 06');
}
