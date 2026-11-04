import type pg from 'pg';
import { withSyncTx } from '../db/sync';
import { decryptCredentials, loadPosKey } from './credentials';
import { getPosAdapter } from './registry';
import { parsePosProvidersEnabled } from './allowlist';
import { upsertMenu } from './upsert';
import type { PosProvider } from './types';

export type MenuFetcher = (r: {
  id: string;
  pos_provider: PosProvider;
  pos_credentials: Record<string, unknown>;
}) => Promise<unknown>;

export function httpMenuFetcher(opts: { fetchImpl?: typeof fetch }): MenuFetcher {
  return async (r) => {
    const base = r.pos_credentials.api_base_url;
    const key = r.pos_credentials.api_key;
    if (typeof base !== 'string' || typeof key !== 'string') {
      throw new Error('pos credentials are missing api_base_url or api_key');
    }
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(`${base}/menu`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`menu fetch failed with status ${res.status}`);
    return res.json();
  };
}

// Each restaurant runs in its own transaction; one failure does not stop the others.
// Errors carry no decrypted credentials.
// Providers outside `enabled` (POS_PROVIDERS_ENABLED) are skipped and reported with a reason.
// Their credentials are not decrypted and nothing is fetched or written for them.
export async function runNightlyMenuSync(
  pool: pg.Pool,
  fetcher: MenuFetcher,
  enabled: ReadonlySet<string> = parsePosProvidersEnabled(process.env.POS_PROVIDERS_ENABLED),
): Promise<{
  synced: number;
  failed: { restaurantId: string; error: string }[];
  skipped: { restaurantId: string; provider: string; reason: 'provider_not_enabled' }[];
}> {
  // LEFT JOIN with '{}' keeps a restaurant that has no credentials row in the failure report,
  // as before, instead of silently skipping it.
  const { rows } = await pool.query(
    `SELECT r.id, r.pos_provider, COALESCE(c.ciphertext, '{}'::jsonb) AS pos_credentials
       FROM restaurant_nodes r
       LEFT JOIN restaurant_pos_credentials c ON c.restaurant_id = r.id
      WHERE r.pos_provider <> 'direct'`,
  );
  let synced = 0;
  const failed: { restaurantId: string; error: string }[] = [];
  const skipped: { restaurantId: string; provider: string; reason: 'provider_not_enabled' }[] = [];
  for (const row of rows) {
    if (!enabled.has(row.pos_provider)) {
      skipped.push({ restaurantId: row.id, provider: row.pos_provider, reason: 'provider_not_enabled' });
      continue;
    }
    try {
      const provider = row.pos_provider as PosProvider;
      const adapter = getPosAdapter(provider);
      if (!adapter) throw new Error(`no adapter registered for ${provider}`);
      const creds = decryptCredentials(row.pos_credentials, loadPosKey());
      const body = await fetcher({ id: row.id, pos_provider: provider, pos_credentials: creds });
      const items = adapter.mapMenu(body);
      await withSyncTx(pool, row.id, (c) => upsertMenu(c, row.id, items, { full: true }));
      synced += 1;
    } catch (e) {
      failed.push({ restaurantId: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { synced, failed, skipped };
}
