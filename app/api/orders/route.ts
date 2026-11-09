import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { HttpError, resolveDiner } from '@/lib/delivery/diner';
import { readJsonBody } from '@/lib/security/body';
import { CheckoutSchema } from '@/lib/delivery-customer/checkout-schema';
import { placeDeliveryOrder, type CheckoutResult } from '@/lib/delivery-customer/checkout';
import { checkoutProvidersFromEnv } from '@/lib/delivery-customer/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<Extract<CheckoutResult, { ok: false }>['code'], number> = {
  UNKNOWN_ITEM: 422,
  OUT_OF_STOCK: 422,
  RESTAURANT_CLOSED: 422,
  AUCTION_NOT_FOUND: 422,
  PAYMENT_UNAVAILABLE: 503,
  DUPLICATE_CHECKOUT: 409,
};

async function handlePost(req: Request): Promise<Response> {
  const pool = await getPool();
  let userId: string;
  try {
    userId = await resolveDiner(req, pool);
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const read = await readJsonBody(req);
  if (!read.ok) return Response.json({ error: read.error }, { status: read.status });
  const parsed = CheckoutSchema.safeParse(read.body);
  if (!parsed.success) return Response.json({ error: 'INVALID_CHECKOUT' }, { status: 400 });

  const result = await placeDeliveryOrder(pool, userId, parsed.data, checkoutProvidersFromEnv());
  if (!result.ok) return Response.json({ error: result.code }, { status: STATUS[result.code] });
  return Response.json(
    {
      orderId: result.orderId,
      status: result.status,
      totalInr: result.totalInr,
      provider: result.provider,
      upiIntentUrl: result.upiIntentUrl,
      reused: result.reused,
    },
    { status: result.reused ? 200 : 201 },
  );
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
