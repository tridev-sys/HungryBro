import type pg from 'pg';
import { randomInt } from 'node:crypto';
import { round2 } from '@/lib/pricing';
import { submitCounterBid } from '@/lib/auction/auction-repository';
import type { KitchenCandidate } from '@/lib/auction/engine';
import { auctionEventsChannel } from '@/lib/mesh/geohash';
import type { MeshBus } from '@/lib/mesh/bus';

// Sandbox kitchens bid at list price (OWNER TO SET, row 2). Dev and test only.
// The staff user id comes from app_restaurant_staff_ids() (migration 007): under RLS the
// runtime role cannot read other users directly.
export async function runSandboxKitchens(args: {
  pool: pg.Pool;
  bus: MeshBus;
  auctionId: string;
  candidates: KitchenCandidate[];
}): Promise<void> {
  const maxDelay = Number(process.env.SANDBOX_BID_DELAY_MS ?? 4000);
  await Promise.all(
    args.candidates.map(async (cand) => {
      const { rows } = await args.pool.query(
        `SELECT id FROM app_restaurant_staff_ids($1) AS t(id) LIMIT 1`,
        [cand.restaurantId],
      );
      if (rows.length === 0) return;
      const delay = maxDelay > 0 ? randomInt(0, maxDelay + 1) : 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const bid = {
        restaurantId: cand.restaurantId,
        offeredPriceInr: round2(cand.lines.reduce((sum, l) => sum + l.basePrice * l.quantity, 0)),
        estimatedPrepMinutes: 12,
        bundleContents: cand.lines,
      };
      await submitCounterBid(args.pool, rows[0].id, args.auctionId, bid);
      await args.bus.publish(auctionEventsChannel(args.auctionId), { type: 'bid', ...bid });
    }),
  );
}
