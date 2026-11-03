import { evaluateCounterBids, matchKitchenNodes, type KitchenCandidate, type CounterBid, type KitchenRepository } from '@/lib/auction/engine';
import type { DeliveryIntent } from '@/types/food-os';

const line = (base: number, qty = 2) => ({ itemId: `i${base}`, name: 'Biryani', basePrice: base, quantity: qty, station: 'Curry' as const });
const cand = (id: string, o: Partial<KitchenCandidate> = {}): KitchenCandidate => ({
  restaurantId: id, name: id, distanceM: 1400, activeKdsLoad: 0.42, ratingAggregate: 4.7, floorMargin: 0.05,
  lines: [line(350, 2)], ...o,
});
const bid = (id: string, offered: number, prep = 12, base = 350): CounterBid => ({
  restaurantId: id, offeredPriceInr: offered, estimatedPrepMinutes: prep, bundleContents: [line(base, 2)],
});

test('ranks passing bids by price ascending and reports the mesh fee split', () => {
  const cands = [cand('K1'), cand('K2', { activeKdsLoad: 0.68, ratingAggregate: 4.6 })];
  const out = evaluateCounterBids(cands, [bid('K2', 749, 15), bid('K1', 710)], 800);
  expect(out.map((b) => b.restaurantId)).toEqual(['K1', 'K2']);
  expect(out[0]).toMatchObject({ offeredPriceInr: 710, meshFee: 24.85, kitchenNet: 685.15 });
});

test('excludes kitchens at load 0.85 or above (strict), even if they bid (Review Focus 2)', () => {
  const cands = [cand('BUSY', { activeKdsLoad: 0.85 })];
  expect(evaluateCounterBids(cands, [bid('BUSY', 690)], 800)).toEqual([]);
});

test('excludes bids above the budget ceiling', () => {
  expect(evaluateCounterBids([cand('K1')], [bid('K1', 850)], 800)).toEqual([]);
});

test('excludes bids that fail the kitchen floor (Review Focus 4)', () => {
  expect(evaluateCounterBids([cand('G', { lines: [line(1000, 1)] })], [bid('G', 500, 12, 1000)], 800)).toEqual([]);
});

test('a zero or negative offer is dropped, not thrown (Review Focus 4)', () => {
  expect(() => evaluateCounterBids([cand('K1')], [bid('K1', 0)], 800)).not.toThrow();
  expect(evaluateCounterBids([cand('K1')], [bid('K1', 0)], 800)).toEqual([]);
  expect(evaluateCounterBids([cand('K1')], [bid('K1', -10)], 800)).toEqual([]);
});

test('ties on price break by rating, then prep time', () => {
  const cands = [cand('LOW', { ratingAggregate: 4.2 }), cand('HIGH', { ratingAggregate: 4.9 })];
  const out = evaluateCounterBids(cands, [bid('LOW', 710), bid('HIGH', 710)], 800);
  expect(out.map((b) => b.restaurantId)).toEqual(['HIGH', 'LOW']);
});

test('matchKitchenNodes re-applies the load cutoff to repository results', async () => {
  const intent = { modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 2 }],
    client_coordinates: { lat: 12.9716, lng: 77.6412 } } as DeliveryIntent;
  const repo: KitchenRepository = { findCandidates: async () => [cand('OK'), cand('BUSY', { activeKdsLoad: 0.9 })] };
  const out = await matchKitchenNodes(repo, intent);
  expect(out.map((c) => c.restaurantId)).toEqual(['OK']);
});
