import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import {
  evaluateCounterBids,
  matchKitchenNodes,
  type CounterBid,
  type KitchenRepository,
  type MatchedLine,
  type RankedBundle,
} from '@/lib/auction/engine';
import type { DispatchAdapter, DispatchTaskRequest } from '@/lib/dispatch/types';
import type { DeliveryIntent } from '@/types/food-os';

export class BidWindowClosedError extends Error {
  constructor() {
    super('bid window is closed');
    this.name = 'BidWindowClosedError';
  }
}

const iso = (v: Date | string) => new Date(v).toISOString();

export async function createAuction(
  pool: pg.Pool,
  dinerId: string,
  input: { transcript: string; intent: DeliveryIntent },
): Promise<{ id: string; windowClosesAt: string; expiresAt: string }> {
  const { intent } = input;
  return asRole(pool, dinerId, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload,
         budget_ceiling_inr, max_sla_minutes, delivery_location)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
       RETURNING id, created_at + INTERVAL '18 seconds' AS window_closes_at, expires_at`,
      [
        dinerId,
        input.transcript,
        JSON.stringify(intent),
        intent.budget_ceiling_inr,
        intent.sla_max_minutes,
        intent.client_coordinates.lng,
        intent.client_coordinates.lat,
      ],
    );
    return {
      id: rows[0].id,
      windowClosesAt: iso(rows[0].window_closes_at),
      expiresAt: iso(rows[0].expires_at),
    };
  });
}

export async function submitCounterBid(
  pool: pg.Pool,
  staffUserId: string,
  auctionId: string,
  bid: CounterBid,
): Promise<{ bidId: string; submittedAt: string }> {
  return asRole(pool, staffUserId, async (c) => {
    // Staff can only see open auctions (mesh_auctions_staff_open_read), so a
    // closed auction returns no row and is treated as closed.
    const { rows: auction } = await c.query(
      `SELECT status, now() < created_at + INTERVAL '18 seconds' AS in_window
         FROM mesh_food_auctions WHERE id = $1`,
      [auctionId],
    );
    if (auction.length === 0 || auction[0].status !== 'open' || !auction[0].in_window) {
      throw new BidWindowClosedError();
    }
    const { rows } = await c.query(
      `INSERT INTO auction_counter_bids
         (auction_id, restaurant_id, offered_price_inr, estimated_prep_minutes, bundle_contents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, submitted_at`,
      [auctionId, bid.restaurantId, bid.offeredPriceInr, bid.estimatedPrepMinutes, JSON.stringify(bid.bundleContents)],
    );
    return { bidId: rows[0].id, submittedAt: iso(rows[0].submitted_at) };
  });
}

export interface CloseResult {
  status: 'open' | 'awarded' | 'expired';
  windowClosesAt: string;
  award?: RankedBundle;
  dispatch?: { provider: string; trackingRef: string };
}

export async function closeIfDue(
  pool: pg.Pool,
  dinerId: string,
  auctionId: string,
  deps: { kitchens: KitchenRepository; dispatch: DispatchAdapter },
): Promise<CloseResult> {
  return asRole(pool, dinerId, async (c) => {
    // The diner owns the row and holds UPDATE rights, so FOR UPDATE is allowed.
    const { rows } = await c.query(
      `SELECT id, status, raw_intent_payload, budget_ceiling_inr::float8 AS budget,
              created_at + INTERVAL '18 seconds' AS window_closes_at,
              now() >= created_at + INTERVAL '18 seconds' AS due,
              now() AS db_now,
              ST_Y(delivery_location::geometry) AS drop_lat,
              ST_X(delivery_location::geometry) AS drop_lng
         FROM mesh_food_auctions WHERE id = $1 FOR UPDATE`,
      [auctionId],
    );
    if (rows.length === 0) throw new Error('auction not found');
    const a = rows[0];
    const windowClosesAt = iso(a.window_closes_at);
    if (a.status !== 'open') return { status: a.status, windowClosesAt };
    if (!a.due) return { status: 'open', windowClosesAt };

    const intent = a.raw_intent_payload as DeliveryIntent;
    const candidates = await matchKitchenNodes(deps.kitchens, intent);
    const { rows: bidRows } = await c.query(
      `SELECT restaurant_id, offered_price_inr::float8 AS offered_price_inr,
              estimated_prep_minutes, bundle_contents
         FROM auction_counter_bids WHERE auction_id = $1`,
      [auctionId],
    );
    const bids: CounterBid[] = bidRows.map((b) => ({
      restaurantId: b.restaurant_id,
      offeredPriceInr: b.offered_price_inr,
      estimatedPrepMinutes: b.estimated_prep_minutes,
      bundleContents: b.bundle_contents as MatchedLine[],
    }));
    const [winner] = evaluateCounterBids(candidates, bids, a.budget);

    if (!winner) {
      await c.query(`UPDATE mesh_food_auctions SET status = 'expired' WHERE id = $1`, [auctionId]);
      return { status: 'expired', windowClosesAt };
    }

    await c.query(
      `UPDATE mesh_food_auctions
          SET status = 'awarded', awarded_restaurant_id = $2, awarded_bid_amount = $3
        WHERE id = $1`,
      [auctionId, winner.restaurantId, winner.offeredPriceInr],
    );

    const { rows: rest } = await c.query(
      `SELECT name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM restaurant_nodes WHERE id = $1`,
      [winner.restaurantId],
    );
    const request: DispatchTaskRequest = {
      deliveryId: auctionId,
      // restaurant_nodes has no street address column in v1; the name stands in for it.
      pickup: { lat: rest[0].lat, lng: rest[0].lng, address: rest[0].name },
      dropoff: { lat: a.drop_lat, lng: a.drop_lng, address: 'Delivery location' },
      readyAt: iso(a.db_now),
      orderValueInr: winner.offeredPriceInr,
    };
    const task = await deps.dispatch.createTask(request);
    await c.query(
      `UPDATE mesh_food_auctions SET assigned_3pl_provider = $2, logistics_tracking_ref = $3 WHERE id = $1`,
      [auctionId, task.provider, task.providerTaskId],
    );
    return {
      status: 'awarded',
      windowClosesAt,
      award: winner,
      dispatch: { provider: task.provider, trackingRef: task.providerTaskId },
    };
  });
}
