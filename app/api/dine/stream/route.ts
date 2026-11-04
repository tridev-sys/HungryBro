import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { asSession } from '@/lib/db/session';
import { readTableSessionToken } from '@/lib/dine/cookie';
import { subscribeKdsEvents, type KdsEvent } from '@/lib/kds/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

/**
 * Diner live feed. Forwards only events whose sessionId is the cookie's open session. A wrong or
 * missing token gets 401 and reveals nothing.
 */
async function handleGet(request: Request) {
  const token = readTableSessionToken(request.headers.get('cookie'));
  if (!token) return new Response('Unauthorized', { status: 401 });

  const pool = await getPool();
  const found = await asSession(pool, { sessionToken: token }, (c) =>
    c.query<{ id: string; restaurant_id: string }>(
      `SELECT s.id, dt.restaurant_id
         FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
        WHERE s.session_token = $1 AND s.status = 'active'`,
      [token]));
  const session = found.rows[0];
  if (!session) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (data: unknown) => controllerRef?.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  const unsubscribe = await subscribeKdsEvents(session.restaurant_id, (e: KdsEvent) => {
    if (e.sessionId === session.id) send(e);
  });

  const cleanup = async () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    await unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
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
