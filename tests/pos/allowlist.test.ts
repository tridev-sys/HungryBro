import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { parsePosProvidersEnabled } from '@/lib/pos/allowlist';

vi.mock('@/lib/db/client', async (orig) => {
  const m = await orig<typeof import('@/lib/db/client')>();
  return { ...m, getPool: vi.fn(m.getPool) };
});
vi.mock('@/lib/db/integration', async (orig) => {
  const m = await orig<typeof import('@/lib/db/integration')>();
  return { ...m, asIntegration: vi.fn(m.asIntegration) };
});

import { getPool } from '@/lib/db/client';
import { asIntegration } from '@/lib/db/integration';
import { petpoojaAdapter } from '@/lib/pos/petpooja';
import { restroworksAdapter } from '@/lib/pos/restroworks';
import { urbanpiperAdapter } from '@/lib/pos/urbanpiper';
import { POST } from '@/app/api/pos/[provider]/[restaurantId]/route';

describe('parsePosProvidersEnabled (pure)', () => {
  test('unset, empty, or blank means no provider is enabled', () => {
    expect(parsePosProvidersEnabled(undefined).size).toBe(0);
    expect(parsePosProvidersEnabled('').size).toBe(0);
    expect(parsePosProvidersEnabled('  ').size).toBe(0);
    expect(parsePosProvidersEnabled(' , ,').size).toBe(0);
  });

  test('splits on commas, trims, and lower-cases provider names', () => {
    const set = parsePosProvidersEnabled(' Petpooja, RESTROWORKS ,,urbanpiper ');
    expect([...set].sort()).toEqual(['petpooja', 'restroworks', 'urbanpiper']);
  });
});

const PROVIDERS = ['petpooja', 'restroworks', 'urbanpiper'] as const;

describe('POS webhook with POS_PROVIDERS_ENABLED unset (fail closed)', () => {
  const saved = process.env.POS_PROVIDERS_ENABLED;
  beforeEach(() => {
    delete process.env.POS_PROVIDERS_ENABLED;
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.POS_PROVIDERS_ENABLED;
    else process.env.POS_PROVIDERS_ENABLED = saved;
  });

  test.each(PROVIDERS)('%s returns 404 without reading the body, verifying, or touching the DB', async (provider) => {
    const adapter = { petpooja: petpoojaAdapter, restroworks: restroworksAdapter, urbanpiper: urbanpiperAdapter }[provider];
    const verify = vi.spyOn(adapter, 'verifySignature');
    const body = '{"event":"menu.sync"}';
    const req = new Request(`http://localhost:3000/api/pos/${provider}/00000000-0000-4000-8000-000000000001`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const res = await POST(req, {
      params: Promise.resolve({ provider, restaurantId: '00000000-0000-4000-8000-000000000001' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(req.bodyUsed).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
    expect(asIntegration).not.toHaveBeenCalled();
    verify.mockRestore();
  });
});
