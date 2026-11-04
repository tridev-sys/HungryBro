import type pg from 'pg';
import { quoteBundle } from '@/lib/pricing';
import { maxPrepMinutes, withinSla } from '@/lib/auction/sla';
import type { DeliveryIntent, LatLng, StationCategory } from '@/types/food-os';

// Pure matching and ranking for the reverse auction. No I/O.
export const AUCTION_MAX_LOAD = 0.85;
export const TRANSIT_RADIUS_M = 6000;
export const BID_WINDOW_MS = 18_000;
export const AUCTION_LIFETIME_MS = 90_000;

export interface MatchedLine {
  itemId: string;
  name: string;
  basePrice: number;
  quantity: number;
  station: StationCategory;
}

export interface KitchenCandidate {
  restaurantId: string;
  name: string;
  distanceM: number;
  activeKdsLoad: number;
  prepMinutes: number;
  ratingAggregate: number;
  floorMargin: number;
  lines: MatchedLine[];
}

export interface CounterBid {
  restaurantId: string;
  offeredPriceInr: number;
  estimatedPrepMinutes: number;
  bundleContents: MatchedLine[];
}

export interface RankedBundle {
  restaurantId: string;
  name: string;
  distanceM: number;
  offeredPriceInr: number;
  meshFee: number;
  kitchenNet: number;
  estimatedPrepMinutes: number;
  ratingAggregate: number;
  bundleContents: MatchedLine[];
}

export interface KitchenSearch {
  point: LatLng;
  radiusM: number;
  maxLoad: number;
  maxPrepMinutes: number;
  items: Array<{ query: string; servingTarget: number }>;
  dietaryProfiles: string[];
}

export interface KitchenRepository {
  /**
   * When `client` is given, the search runs on that connection (the caller's transaction) and
   * must not take another pool connection.
   */
  findCandidates(search: KitchenSearch, client?: pg.PoolClient): Promise<KitchenCandidate[]>;
}

export function evaluateCounterBids(
  candidates: KitchenCandidate[],
  bids: CounterBid[],
  budgetInr: number,
): RankedBundle[] {
  const byId = new Map(candidates.map((c) => [c.restaurantId, c]));
  const ranked: RankedBundle[] = [];
  for (const bid of bids) {
    const cand = byId.get(bid.restaurantId);
    if (!cand) continue;
    if (cand.activeKdsLoad > AUCTION_MAX_LOAD) continue;
    if (!withinSla(bid.estimatedPrepMinutes)) continue;
    let quote;
    try {
      quote = quoteBundle(
        bid.bundleContents.map((l) => ({ basePrice: l.basePrice, quantity: l.quantity })),
        bid.offeredPriceInr,
        cand.floorMargin,
      );
    } catch (err) {
      if (err instanceof RangeError) continue;
      throw err;
    }
    if (!quote.passesFloor || bid.offeredPriceInr > budgetInr) continue;
    ranked.push({
      restaurantId: bid.restaurantId,
      name: cand.name,
      distanceM: cand.distanceM,
      offeredPriceInr: bid.offeredPriceInr,
      meshFee: quote.meshFee,
      kitchenNet: quote.kitchenNet,
      estimatedPrepMinutes: bid.estimatedPrepMinutes,
      ratingAggregate: cand.ratingAggregate,
      bundleContents: bid.bundleContents,
    });
  }
  return ranked.sort(
    (a, b) =>
      a.offeredPriceInr - b.offeredPriceInr ||
      b.ratingAggregate - a.ratingAggregate ||
      a.estimatedPrepMinutes - b.estimatedPrepMinutes ||
      a.distanceM - b.distanceM,
  );
}

export async function matchKitchenNodes(
  repo: KitchenRepository,
  intent: DeliveryIntent,
  client?: pg.PoolClient,
): Promise<KitchenCandidate[]> {
  const found = await repo.findCandidates({
    point: intent.client_coordinates,
    radiusM: TRANSIT_RADIUS_M,
    maxLoad: AUCTION_MAX_LOAD,
    maxPrepMinutes: maxPrepMinutes(),
    items: intent.items_requested.map((i) => ({ query: i.query, servingTarget: i.serving_target })),
    dietaryProfiles: intent.target_dietary_profiles,
  }, client);
  return found.filter((c) =>
    c.activeKdsLoad <= AUCTION_MAX_LOAD && c.distanceM <= TRANSIT_RADIUS_M && withinSla(c.prepMinutes));
}
