import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { HttpError, resolveDiner } from '@/lib/delivery/diner';
import { readJsonBody } from '@/lib/security/body';
import { DeliveryRequestSchema } from '@/lib/delivery/request';
import { createAuction, readCounterBids } from '@/lib/auction/auction-repository';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { evaluateCounterBids, matchKitchenNodes } from '@/lib/auction/engine';
import { runSandboxKitchens } from '@/lib/auction/sandbox-kitchens';
import { createMeshBus, MeshBusUnavailableError, publishIntentToBlock, withBusDeadline } from '@/lib/mesh/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handlePost(req: Request): Promise<Response> {
  const pool = await getPool();
  let dinerId: string;
  try {
    dinerId = await resolveDiner(req, pool);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    throw err;
  }

  const read = await readJsonBody(req);
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = read.body;
  const parsed = DeliveryRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid request', issues: parsed.error.issues }, 400);
  const { transcript, intent } = parsed.data;

  const auction = await createAuction(pool, dinerId, { transcript, intent });
  const candidates = await matchKitchenNodes(createPostgisKitchenRepository(pool), intent);

  const bus = createMeshBus();
  let bundles;
  try {
    try {
      await withBusDeadline(publishIntentToBlock(bus, intent.client_coordinates, { auctionId: auction.id, intent }));
    } catch (err) {
      if (err instanceof MeshBusUnavailableError) {
        return json({ error: 'mesh bus unavailable', code: 'MESH_BUS_UNAVAILABLE' }, 503);
      }
      throw err;
    }
    await runSandboxKitchens({ pool, bus, auctionId: auction.id, candidates });
    const bids = await readCounterBids(pool, dinerId, auction.id);
    bundles = evaluateCounterBids(candidates, bids, intent.budget_ceiling_inr);
  } finally {
    await bus.close().catch(() => undefined);
  }

  return json(
    { auctionId: auction.id, windowClosesAt: auction.windowClosesAt, candidates: candidates.length, bundles },
    201,
  );
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
