import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import type pg from 'pg';
import { createAuction, submitCounterBid, closeIfDue, BidWindowClosedError } from '@/lib/auction/auction-repository';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { createSandboxDispatch } from '@/lib/dispatch/sandbox';
import { makeUser, makeRestaurant, makeMenuItem, makeAuction } from '../helpers/mesh-fixtures';
import { randomUUID } from 'node:crypto';
import type { DeliveryIntent } from '@/types/food-os';

const admin = getAdminPool();
let pool: pg.Pool; // runtime pool (food_app_login), opened in beforeAll
let kitchens: ReturnType<typeof createPostgisKitchenRepository>;
const dispatch = createSandboxDispatch();
const P = { lat: 12.9716, lng: 77.6412 };
beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
  pool = await getPool();
  kitchens = createPostgisKitchenRepository(pool);
});
afterAll(async () => { await pool.end(); await admin.end(); });

async function setup() {
  const item = `item${randomUUID().slice(0, 8)}`;
  const diner = await makeUser(admin, 'diner');
  const r = await makeRestaurant(admin, { lat: P.lat, lng: P.lng });
  await makeMenuItem(admin, r, item, 350);
  const staff = await makeUser(admin, 'restaurant_staff', r);
  const intent = { modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 1,
    target_dietary_profiles: [], items_requested: [{ query: item, serving_target: 2 }],
    client_coordinates: P } as DeliveryIntent;
  const bundle = [{ itemId: 'x', name: item, basePrice: 350, quantity: 2, station: 'Curry' as const }];
  return { item, diner, r, staff, intent, bundle };
}

test('a bid 1 second into the window is accepted and persisted', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 1, intent: s.intent });
  const { bidId } = await submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle });
  expect(bidId).toBeTruthy();
});

test('a bid at 18.5 seconds is rejected with BidWindowClosedError (Review Focus 1)', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 18.5, intent: s.intent });
  await expect(submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle }))
    .rejects.toBeInstanceOf(BidWindowClosedError);
});

test('closeIfDue before 18 seconds leaves the auction open', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 5, intent: s.intent });
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('open');
});

test('closeIfDue after 18 seconds awards the best valid bid and dispatches it', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 1, intent: s.intent });
  await submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle });
  // Move the clock: backdate the auction so the window is over.
  await admin.query(`UPDATE mesh_food_auctions SET created_at = created_at - INTERVAL '18 seconds' WHERE id = $1`, [a]);
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('awarded');
  expect(res.award?.restaurantId).toBe(s.r);
  expect(res.dispatch?.provider).toBe('shadowfax');
  const { rows } = await admin.query(`SELECT status, awarded_restaurant_id FROM mesh_food_auctions WHERE id = $1`, [a]);
  expect(rows[0]).toEqual({ status: 'awarded', awarded_restaurant_id: s.r });
});

test('closeIfDue with no valid bids marks the auction expired', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 19, intent: s.intent });
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('expired');
});

// Regression: closeIfDue used to take a second pool connection for the kitchen search while
// holding the auction row lock. With 20 closers on the 10-connection pool, every connection
// ended up waiting and nothing resolved (self-deadlock). All closers must now resolve.
test('20 concurrent closeIfDue on one due auction: exactly one award, one dispatch, all resolve in 10 s', async () => {
  const s = await setup();
  const a = await makeAuction(admin, s.diner, { createdAgoSeconds: 1, intent: s.intent });
  await submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle });
  await admin.query(`UPDATE mesh_food_auctions SET created_at = created_at - INTERVAL '18 seconds' WHERE id = $1`, [a]);

  const closers = Array.from({ length: 20 }, () => closeIfDue(pool, s.diner, a, { kitchens, dispatch }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), 10_000); });
  const outcome = await Promise.race([Promise.allSettled(closers), timedOut]);
  clearTimeout(timer);

  expect(outcome).not.toBe('timeout');
  const results = outcome as PromiseSettledResult<Awaited<ReturnType<typeof closeIfDue>>>[];
  expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  const values = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  expect(values.filter((v) => v.award).length).toBe(1);
  expect(values.filter((v) => v.dispatch).length).toBe(1);
  expect(values.every((v) => v.status === 'awarded')).toBe(true);
  const { rows } = await admin.query(`SELECT status, awarded_restaurant_id FROM mesh_food_auctions WHERE id = $1`, [a]);
  expect(rows[0]).toEqual({ status: 'awarded', awarded_restaurant_id: s.r });
}, 20_000);
