import { createHash } from 'node:crypto';
import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { z } from 'zod';
import { getPool } from '@/lib/db/client';
import { asIntegration } from '@/lib/db/integration';
import { decryptCredentials, loadPosKey } from '@/lib/pos/credentials';
import { getPosAdapter } from '@/lib/pos/registry';
import { parsePosProvidersEnabled } from '@/lib/pos/allowlist';
import { setStock, upsertMenu } from '@/lib/pos/upsert';
import { PosPayloadError } from '@/lib/pos/types';

export const runtime = 'nodejs';

// A signed event older than this is refused (replay window), when the provider gives its time.
const POS_EVENT_MAX_AGE_MS = 5 * 60 * 1000;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

// Order of operations is fixed: resolve the restaurant, verify the signature, then parse,
// then write. All of it runs in one transaction, so a failure rolls back.
async function handlePost(
  req: Request,
  ctx: { params: Promise<{ provider: string; restaurantId: string }> },
): Promise<Response> {
  const { provider, restaurantId } = await ctx.params;
  // Allow-list gate first: a provider that is not enabled gets 404 before the body is read,
  // before any signature check, and before any database access.
  if (!parsePosProvidersEnabled(process.env.POS_PROVIDERS_ENABLED).has(provider)) {
    return json(404, { error: 'not_found' });
  }
  const adapter = getPosAdapter(provider);
  if (!adapter || !z.string().uuid().safeParse(restaurantId).success) {
    return json(404, { error: 'not_found' });
  }

  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  try {
    const result = await asIntegration(await getPool(), restaurantId, async (c) => {
      const { rows } = await c.query('SELECT pos_provider FROM restaurant_nodes WHERE id = $1', [restaurantId]);
      if (rows.length === 0 || rows[0].pos_provider !== provider) {
        return { status: 404, body: { error: 'not_found' } };
      }
      // food_app cannot read restaurant_pos_credentials; this function returns one row's ciphertext.
      const { rows: credRows } = await c.query(
        'SELECT app_pos_credentials_for_restaurant($1) AS ciphertext',
        [restaurantId],
      );
      // Decrypt only after the provider check, and only in this server process (shared decision 6).
      const creds = decryptCredentials(credRows[0]?.ciphertext ?? {}, loadPosKey());
      const secret = typeof creds.webhook_secret === 'string' ? creds.webhook_secret : '';
      if (!adapter.verifySignature({ rawBody, headers, secret })) {
        return { status: 401, body: { error: 'unauthorized' } };
      }
      const event = adapter.parseWebhook(rawBody, {
        expectedLocationId: typeof creds.location_id === 'string' ? creds.location_id : undefined,
      });
      if (event.kind !== 'ignored') {
        if (event.occurredAtMs !== undefined && Math.abs(Date.now() - event.occurredAtMs) > POS_EVENT_MAX_AGE_MS) {
          return { status: 401, body: { error: 'stale' } };
        }
        // Replay guard: the same signed body is applied once for each restaurant.
        const eventHash = createHash('sha256').update(rawBody).digest('hex');
        const { rowCount } = await c.query(
          'INSERT INTO pos_webhook_events (restaurant_id, event_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [restaurantId, eventHash]);
        if (rowCount === 0) return { status: 409, body: { error: 'replayed' } };
      }
      if (event.kind === 'menu') await upsertMenu(c, restaurantId, event.items, { full: event.full });
      if (event.kind === 'stock') await setStock(c, restaurantId, event.pos_item_code, event.is_in_stock);
      return { status: 200, body: { ok: true, result: event.kind } };
    });
    return json(result.status, result.body);
  } catch (e) {
    if (e instanceof PosPayloadError) return json(400, { error: 'invalid_payload' });
    throw e;
  }
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
