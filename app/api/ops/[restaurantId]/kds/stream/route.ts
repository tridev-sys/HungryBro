import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { subscribeKdsEvents, type KdsEvent } from '@/lib/kds/events';
import { backpressureWarning, refreshKitchenLoad } from '@/lib/kds/load';
import { loadBoard } from '@/lib/kds/board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const STAFF_ROLES = ['restaurant_staff', 'kitchen_lead'];

async function handleGet(request: Request, { params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const pool = await getPool();
  const actor = await resolveActor(pool, request.headers.get('cookie'));
  if (!actor) return new Response('Unauthorized', { status: 401 });
  if (actor.restaurantId !== restaurantId || !STAFF_ROLES.includes(actor.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  let live = false;
  let chain: Promise<void> = Promise.resolve();
  const buffer: KdsEvent[] = [];
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const send = (data: unknown) => controllerRef?.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  // A fired ticket changes the load, so staff refresh it before the event reaches the board.
  const forward = async (e: KdsEvent) => {
    try {
      const load = await refreshKitchenLoad(pool, actor.userId, restaurantId);
      send({ type: 'load', load, backpressure: backpressureWarning(load) });
    } catch (err) {
      console.error('kitchen load refresh failed', err);
    }
    send(e);
  };

  // Subscribe before the snapshot, so no event fired in between is lost.
  const unsubscribe = await subscribeKdsEvents(restaurantId, (e) => {
    if (!live) buffer.push(e);
    else chain = chain.then(() => forward(e));
  });
  const initial = await loadBoard(pool, actor, restaurantId);

  const cleanup = async () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    await unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      send({ type: 'snapshot', ...initial });
      for (const e of buffer.splice(0)) chain = chain.then(() => forward(e));
      live = true;
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), HEARTBEAT_MS);
    },
    cancel() {
      return cleanup();
    },
  });

  request.signal.addEventListener('abort', () => {
    void cleanup();
    try { controllerRef?.close(); } catch { /* already closed */ }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}

export const GET = withApiGuards(handleGet, { sessionToken: publicSessionToken });
