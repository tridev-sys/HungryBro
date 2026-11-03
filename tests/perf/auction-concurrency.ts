// Check 2: auction correctness under concurrency. Drives the real repository functions
// (lib/auction/auction-repository.ts) through the app role (APP_DATABASE_URL, RLS enforced).
// Phases:
//   A  200 concurrent counter-bids inside the 18 s window: all accepted, none lost.
//   B  200 concurrent counter-bids after the window (created_at backdated 19 s): all rejected.
//   C  bids streamed every 40 ms across the window boundary: no accepted bid at or after created_at + 18 s.
//   D  5 concurrent closeIfDue (below the app pool size) on one due auction: exactly one award.
//   E  20 concurrent closeIfDue (at 2x the pool size) with a 15 s cap: probes pool self-deadlock.
// Run: sh -c '. tests/perf/env.sh && perf_node npx tsx tests/perf/auction-concurrency.ts'
import { getPool } from '@/lib/db/client';
import {
  BidWindowClosedError, closeIfDue, createAuction, submitCounterBid,
} from '@/lib/auction/auction-repository';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { matchKitchenNodes } from '@/lib/auction/engine';
import { createSandboxDispatch } from '@/lib/dispatch/sandbox';
import type { DeliveryIntent } from '@/types/food-os';
import { adminPool, DINER_PHONE, report, sleep, summarize, userIdByPhone } from './lib/common';
import type pg from 'pg';

const intent: DeliveryIntent = {
  modality: 'DELIVERY', budget_ceiling_inr: 5000, sla_max_minutes: 45, headcount: 1,
  target_dietary_profiles: [], items_requested: [{ query: 'Chicken Biryani', serving_target: 1 }],
  client_coordinates: { lat: 12.9719, lng: 77.6408 },
};

async function main() {
  const app = getPool();
  const p = await app;
  const admin = adminPool();
  const dinerId = await userIdByPhone(admin, DINER_PHONE);
  const staff = (await admin.query(
    `SELECT id, restaurant_id FROM users WHERE role = 'restaurant_staff' AND phone_number LIKE '+9190000000%' ORDER BY phone_number`)).rows as Array<{ id: string; restaurant_id: string }>;
  if (staff.length < 3) throw new Error('need 3 seeded restaurant staff');
  const bidFor = (r: { restaurant_id: string }, n: number) => ({
    restaurantId: r.restaurant_id, offeredPriceInr: 300 + n * 0.01, estimatedPrepMinutes: 12,
    bundleContents: [{ itemId: 'x', name: 'Chicken Biryani', basePrice: 300, quantity: 1, station: 'Curry' as const }],
  });
  const newAuction = (tag: string) => createAuction(p, dinerId, { transcript: `perf auction ${tag}`, intent });
  const created: string[] = [];

  // Phase A
  const a = await newAuction('A');
  created.push(a.id);
  const expiresMs = Date.parse(a.expiresAt) - Date.parse(a.windowClosesAt) + 18_000 - 0;
  const aLat: number[] = [];
  let aAccepted = 0; let aOther = 0;
  await Promise.all(Array.from({ length: 200 }, async (_, i) => {
    const r = staff[i % 3];
    const t0 = performance.now();
    try { await submitCounterBid(p, r.id, a.id, bidFor(r, i)); aAccepted++; } catch (e) { aOther++; console.error('A err', e); }
    aLat.push(performance.now() - t0);
  }));
  const aRows = Number((await admin.query('SELECT count(*)::int n FROM auction_counter_bids WHERE auction_id=$1', [a.id])).rows[0].n);

  // Phase B
  const b = await newAuction('B');
  created.push(b.id);
  await admin.query(`UPDATE mesh_food_auctions SET created_at = now() - interval '19 seconds' WHERE id = $1`, [b.id]);
  let bRejected = 0; let bAccepted = 0;
  await Promise.all(Array.from({ length: 200 }, async (_, i) => {
    const r = staff[i % 3];
    try { await submitCounterBid(p, r.id, b.id, bidFor(r, i)); bAccepted++; } catch (e) { if (e instanceof BidWindowClosedError) bRejected++; else throw e; }
  }));
  const bRows = Number((await admin.query('SELECT count(*)::int n FROM auction_counter_bids WHERE auction_id=$1', [b.id])).rows[0].n);

  // Phase C
  const c = await newAuction('C');
  created.push(c.id);
  let cAccepted = 0; let cRejected = 0;
  const cStart = Date.now();
  const cJobs: Promise<void>[] = [];
  for (let i = 0; Date.now() - cStart < 22_000; i++) {
    const r = staff[i % 3];
    cJobs.push((async () => {
      try { await submitCounterBid(p, r.id, c.id, bidFor(r, i)); cAccepted++; } catch (e) { if (e instanceof BidWindowClosedError) cRejected++; else throw e; }
    })());
    await sleep(40);
  }
  await Promise.all(cJobs);
  const cBoundary = (await admin.query(
    `SELECT count(*)::int AS late,
            extract(epoch from (max(submitted_at) - min(created_at)))::float8 AS last_offset_s
       FROM auction_counter_bids b JOIN mesh_food_auctions m ON m.id = b.auction_id
      WHERE b.auction_id = $1 AND b.submitted_at >= m.created_at + interval '18 seconds'`, [c.id])).rows[0];
  const cLastOffset = (await admin.query(
    `SELECT extract(epoch from (max(b.submitted_at) - min(m.created_at)))::float8 AS s
       FROM auction_counter_bids b JOIN mesh_food_auctions m ON m.id = b.auction_id WHERE b.auction_id=$1`, [c.id])).rows[0].s;

  // Shared setup for D and E: a due, open auction with six in-window bids.
  const makeDue = async (tag: string) => {
    const x = await newAuction(tag);
    created.push(x.id);
    // Bids mirror lib/auction/sandbox-kitchens.ts: list price from the matched lines.
    const cands = await matchKitchenNodes(kitchens, intent);
    for (const cand of cands) {
      const s = staff.find((st) => st.restaurant_id === cand.restaurantId);
      if (!s) continue;
      await submitCounterBid(p, s.id, x.id, { restaurantId: cand.restaurantId,
        offeredPriceInr: Math.round(cand.lines.reduce((t, l) => t + l.basePrice * l.quantity, 0) * 100) / 100,
        estimatedPrepMinutes: 12, bundleContents: cand.lines });
    }
    await admin.query(`UPDATE mesh_food_auctions SET created_at = now() - interval '19 seconds' WHERE id = $1`, [x.id]);
    return x.id;
  };
  const dispatch = createSandboxDispatch();
  let createTaskCalls = 0;
  const countingDispatch = { ...dispatch, createTask: async (req: Parameters<typeof dispatch.createTask>[0]) => { createTaskCalls++; return dispatch.createTask(req); } };
  const kitchens = createPostgisKitchenRepository(p);

  // Phase D
  const dId = await makeDue('D');
  const dClosers = await Promise.all(Array.from({ length: 5 }, () =>
    closeIfDue(p, dinerId, dId, { kitchens, dispatch: countingDispatch as typeof dispatch })));
  const dWinners = new Set(dClosers.filter((r) => r.award).map((r) => r.award!.restaurantId));
  const dRow = (await admin.query(
    `SELECT status, awarded_restaurant_id, assigned_3pl_provider FROM mesh_food_auctions WHERE id=$1`, [dId])).rows[0];

  // Phase E: probe. Each closer holds a transaction (FOR UPDATE) and then needs a second pool
  // connection for the kitchen search. With 20 closers the 10-connection pool can fill with waiters.
  const eId = await makeDue('E');
  const eStart = performance.now();
  const eResults: Array<'resolved' | 'pending'> = [];
  const eCalls = Array.from({ length: Number(process.env.PERF_E_CLOSERS ?? 20) }, () =>
    closeIfDue(p, dinerId, eId, { kitchens, dispatch: countingDispatch as typeof dispatch })
      .then(() => { eResults.push('resolved'); }));
  const eTimer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 15_000));
  const eWhich = await Promise.race([Promise.allSettled(eCalls).then(() => 'all' as const), eTimer]);
  const eResolved = eResults.length;
  const eStats = (await admin.query(
    `SELECT count(*) FILTER (WHERE state = 'active' AND wait_event_type = 'Lock')::int AS lock_waiters,
            count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
            count(*)::int AS total
       FROM pg_stat_activity WHERE datname = 'food_os' AND usename = 'food_app_login'`)).rows[0];

  report('auction-concurrency', {
    expiryLifetimeMs: Math.round(expiresMs),
    A_inWindow200: { accepted: aAccepted, errors: aOther, rowsInDb: aRows, latencyMs: summarize(aLat) },
    B_afterWindow200: { rejectedWithWindowClosed: bRejected, accepted: bAccepted, rowsInDb: bRows },
    C_boundaryStream: { accepted: cAccepted, rejected: cRejected, acceptedAtOrAfter18s: cBoundary.late, lastAcceptedOffsetS: Number(cLastOffset) },
    D_awardRace5: { closersReturningAward: dClosers.filter((r) => r.award).length, distinctWinners: dWinners.size,
      dispatchResults: dClosers.filter((r) => r.dispatch).length, createTaskCallsSoFar: createTaskCalls,
      dbStatus: dRow.status, dbAwardedSet: dRow.awarded_restaurant_id !== null, dbProvider: dRow.assigned_3pl_provider },
    E_closersProbe: { closers: eCalls.length, resolvedWithin15s: eResolved, outcome: eWhich, elapsedMs: Math.round(performance.now() - eStart),
      poolBackends: eStats.total, lockWaiters: eStats.lock_waiters, idleInTransaction: eStats.idle_in_tx },
  });

  // Cleanup: E may still hold connections, so exit hard after the report. Rows are removed by a
  // separate admin step (tests/perf/cleanup.ts) once Postgres aborts the stuck transactions.
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
