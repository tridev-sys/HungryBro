// ONDC BAP (buyer app) request builders. Live sending is disabled by configuration:
// liveSend stays false until Plan 07 ops enables it after onboarding.

export interface BapConfig {
  bapId: string;
  bapUri: string;
  gatewayUrl: string;
  domain: 'ONDC:RET10';
  country: 'IND';
  city: 'std:080';
  coreVersion: '1.2.0';
  liveSend: boolean; // default false; only Plan 07 ops may set true
}

export interface BecknEnvelope {
  context: {
    domain: string;
    action: string;
    transaction_id: string;
    message_id: string;
    timestamp: string;
    bap_id?: string;
    bpp_id?: string;
    [k: string]: unknown;
  };
  message: Record<string, unknown>;
}

export class NotEnabledError extends Error {}

interface CommonParams {
  transactionId: string;
  messageId: string;
  timestamp: string;
}

// Beckn GPS strings are "lat,lng" (latitude first).
const gps = (lat: number, lng: number) => `${lat},${lng}`;

function baseContext(cfg: BapConfig, action: string, p: CommonParams): BecknEnvelope['context'] {
  return {
    domain: cfg.domain,
    country: cfg.country,
    city: cfg.city,
    action,
    core_version: cfg.coreVersion,
    bap_id: cfg.bapId,
    bap_uri: cfg.bapUri,
    transaction_id: p.transactionId,
    message_id: p.messageId,
    timestamp: p.timestamp,
  };
}

export function buildSearchRequest(
  cfg: BapConfig,
  p: CommonParams & { query: string; lat: number; lng: number },
): BecknEnvelope {
  return {
    context: baseContext(cfg, 'search', p),
    message: {
      intent: {
        item: { descriptor: { name: p.query } },
        fulfillment: { end: { location: { gps: gps(p.lat, p.lng) } } },
      },
    },
  };
}

export function buildSelectRequest(
  cfg: BapConfig,
  p: CommonParams & {
    bppId: string;
    providerId: string;
    items: { id: string; count: number }[];
    lat: number;
    lng: number;
  },
): BecknEnvelope {
  return {
    context: { ...baseContext(cfg, 'select', p), bpp_id: p.bppId },
    message: {
      order: {
        provider: { id: p.providerId },
        items: p.items.map((i) => ({ id: i.id, quantity: { count: i.count } })),
        fulfillments: [{ end: { location: { gps: gps(p.lat, p.lng) } } }],
      },
    },
  };
}

export class BapClient {
  constructor(
    private readonly cfg: BapConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  buildSearch(p: CommonParams & { query: string; lat: number; lng: number }): BecknEnvelope {
    return buildSearchRequest(this.cfg, p);
  }

  buildSelect(
    p: CommonParams & { bppId: string; providerId: string; items: { id: string; count: number }[]; lat: number; lng: number },
  ): BecknEnvelope {
    return buildSelectRequest(this.cfg, p);
  }

  async send(envelope: BecknEnvelope): Promise<unknown> {
    if (!this.cfg.liveSend) throw new NotEnabledError('ONDC live send is disabled until onboarding');
    const res = await this.fetchImpl(`${this.cfg.gatewayUrl}/${envelope.context.action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ONDC gateway responded with status ${res.status}`);
    return res.json();
  }
}
