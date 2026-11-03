import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool, asRole } from '@/lib/db/client';
import { HttpError, resolveDiner } from '@/lib/delivery/diner';
import { closeIfDue, readCounterBids } from '@/lib/auction/auction-repository';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { assertSandboxDispatchMode, createSandboxDispatch } from '@/lib/dispatch/sandbox';
import { createMeshBus } from '@/lib/mesh/bus';
import { auctionEventsChannel } from '@/lib/mesh/geohash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICK_MS = 1000;
const PING_MS = 15_000;
const enc = new TextEncoder();

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Event contract: snapshot (first), bid (per counter-bid), status (on change),
// dispatch (once, after award, with the handshake token for this diner only), and
// a ': ping' comment every 15 s. Subscribes before the snapshot so no bid is missed.
async function handleGet(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const pool = await getPool();

  let dinerId: string;
  try {
    dinerId = await resolveDiner(req, pool);
    assertSandboxDispatchMode();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 503);
  }

  const { rows: exists } = await asRole(pool, dinerId, (c) =>
    c.query(`SELECT id FROM mesh_food_auctions WHERE id = $1`, [id]));
  if (exists.length === 0) return json({ error: 'auction not found' }, 404);

  const dispatch = createSandboxDispatch();
  const kitchens = createPostgisKitchenRepository(pool);
  const bus = createMeshBus();

  let closed = false;
  let unsubscribe: (() => Promise<void>) | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (tickTimer) clearInterval(tickTimer);
        if (pingTimer) clearInterval(pingTimer);
        try {
          await unsubscribe?.();
        } finally {
          await bus.close().catch(() => undefined);
          try {
            controller.close();
          } catch {
            // Already closed by the runtime.
          }
        }
      };
      req.signal.addEventListener('abort', () => void cleanup());

      try {
        unsubscribe = await bus.subscribe([auctionEventsChannel(id)], (_ch, msg) => send('bid', msg));
        pingTimer = setInterval(() => {
          if (!closed) controller.enqueue(enc.encode(': ping\n\n'));
        }, PING_MS);

        const { rows } = await asRole(pool, dinerId, (c) =>
          c.query(
            `SELECT status, created_at + INTERVAL '18 seconds' AS window_closes_at
               FROM mesh_food_auctions WHERE id = $1`,
            [id],
          ));
        const snapshotStatus = rows[0].status as string;
        const windowClosesAt = new Date(rows[0].window_closes_at).toISOString();
        const bids = await readCounterBids(pool, dinerId, id);
        send('snapshot', { status: snapshotStatus, windowClosesAt, bids });
        if (snapshotStatus !== 'open') {
          await cleanup();
          return;
        }

        let busy = false;
        tickTimer = setInterval(async () => {
          if (busy || closed) return;
          busy = true;
          try {
            const res = await closeIfDue(pool, dinerId, id, { kitchens, dispatch });
            if (res.status === 'open') return;
            send('status', { status: res.status, windowClosesAt: res.windowClosesAt });
            if (res.status === 'awarded' && res.dispatch) {
              const task = await dispatch.getTask(res.dispatch.trackingRef);
              const { rows: tok } = await asRole(pool, dinerId, (c) =>
                c.query(`SELECT handshake_token FROM mesh_food_auctions WHERE id = $1`, [id]));
              send('dispatch', {
                provider: res.dispatch.provider,
                trackingRef: res.dispatch.trackingRef,
                handshakeToken: tok[0].handshake_token,
                rider: task.rider,
                bagTempC: task.bagTempC,
                etaMinutes: task.etaMinutes,
              });
            }
            await cleanup();
          } catch (err) {
            send('error', { message: (err as Error).message });
            await cleanup();
          } finally {
            busy = false;
          }
        }, TICK_MS);
      } catch (err) {
        send('error', { message: (err as Error).message });
        await cleanup();
      }
    },
    async cancel() {
      closed = true;
      if (tickTimer) clearInterval(tickTimer);
      if (pingTimer) clearInterval(pingTimer);
      await unsubscribe?.().catch(() => undefined);
      await bus.close().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

export const GET = withApiGuards(handleGet, { sessionToken: publicSessionToken });
