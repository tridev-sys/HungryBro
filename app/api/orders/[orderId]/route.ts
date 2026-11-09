import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { HttpError, resolveDiner } from '@/lib/delivery/diner';
import { getOrderStatus } from '@/lib/delivery-customer/order-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: Request, ctx: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const pool = await getPool();
  let userId: string;
  try {
    userId = await resolveDiner(req, pool);
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const { orderId } = await ctx.params;
  if (!UUID_RE.test(orderId)) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const view = await getOrderStatus(pool, userId, orderId);
  if (!view) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  return Response.json(view, { status: 200 });
}

export const GET = withApiGuards(handleGet, { sessionToken: publicSessionToken });
