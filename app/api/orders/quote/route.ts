import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { asRole, getPool } from '@/lib/db/client';
import { readJsonBody } from '@/lib/security/body';
import { CartSubmitSchema } from '@/lib/delivery-customer/checkout-schema';
import { priceCart } from '@/lib/delivery-customer/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handlePost(req: Request): Promise<Response> {
  const read = await readJsonBody(req);
  if (!read.ok) return Response.json({ error: read.error }, { status: read.status });
  const parsed = CartSubmitSchema.safeParse(read.body);
  if (!parsed.success) return Response.json({ error: 'INVALID_CART' }, { status: 400 });
  const priced = await asRole(await getPool(), null, (c) => priceCart(c, parsed.data.restaurantId, parsed.data.lines));
  if (!priced.ok) return Response.json({ error: priced.code }, { status: 422 });
  return Response.json(priced, { status: 200 });
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
