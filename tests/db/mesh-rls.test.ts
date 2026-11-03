import { getPool, runMigrations, asRole } from '@/lib/db/client';
import { makeUser, makeRestaurant, makeAuction } from '../helpers/mesh-fixtures';
import type pg from 'pg';

const pool = getPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const bidSql = `INSERT INTO auction_counter_bids
  (auction_id, restaurant_id, offered_price_inr, estimated_prep_minutes, bundle_contents)
  VALUES ($1, $2, 700, 12, '[]')`;

test('a diner cannot open an auction for another diner', async () => {
  const a = await makeUser(pool, 'diner');
  const b = await makeUser(pool, 'diner');
  await expect(asRole(pool, a, (c) => c.query(
    `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload,
       budget_ceiling_inr, max_sla_minutes, delivery_location)
     VALUES ($1, 'x', '{}', 800, 30, ST_SetSRID(ST_MakePoint(77.6, 12.9), 4326))`, [b])))
    .rejects.toThrow(/row-level security/);
});

test('kitchen staff cannot place a bid for another restaurant', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const rY = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner);
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rY])))
    .rejects.toThrow(/row-level security/);
});

test('staff can bid for their own restaurant inside the window', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner, { createdAgoSeconds: 1 });
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rX]))).resolves.toBeDefined();
});

test('a bid after 18 seconds is rejected by RLS (Review Focus 1)', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner, { createdAgoSeconds: 18.5 });
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rX])))
    .rejects.toThrow(/row-level security/);
});
