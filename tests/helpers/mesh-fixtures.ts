// Test fixtures for the mesh auction tables. Inserted through the pool passed in
// (the fixture pool connects as the migration/seed role, which bypasses RLS).
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { DeliveryIntent } from '@/types/food-os';

const GSTIN = '29ABCDE1234F1Z5';

function randomDigits(len: number): string {
  const n = BigInt(`0x${randomUUID().replace(/-/g, '').slice(0, 16)}`);
  return (n % 10n ** BigInt(len)).toString().padStart(len, '0');
}

export async function makeUser(pool: pg.Pool, role: string, restaurantId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id`,
    [`+91${randomDigits(10)}`, role, restaurantId],
  );
  return rows[0].id as string;
}

export async function makeRestaurant(
  pool: pg.Pool,
  o: { lat: number; lng: number; load?: number; rating?: number; floor?: number },
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location,
       operational_floor_margin, active_kds_load, rating_aggregate)
     VALUES ($1, $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8)
     RETURNING id`,
    [
      `r-${randomUUID().slice(0, 12)}`,
      randomDigits(14),
      GSTIN,
      o.lng,
      o.lat,
      o.floor ?? 0.05,
      o.load ?? 0,
      o.rating ?? 0,
    ],
  );
  return rows[0].id as string;
}

export async function makeMenuItem(
  pool: pg.Pool,
  restaurantId: string,
  name: string,
  price: number,
  station = 'General',
): Promise<void> {
  const cat = await pool.query(
    `INSERT INTO menu_categories (restaurant_id, name, station) VALUES ($1, $2, $2) RETURNING id`,
    [restaurantId, station],
  );
  await pool.query(
    `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary, is_in_stock)
     VALUES ($1, $2, $3, $4, $5, 'non_veg', TRUE)`,
    [restaurantId, cat.rows[0].id, `fx-${randomUUID()}`, name, price],
  );
}

export function defaultIntent(): DeliveryIntent {
  return {
    modality: 'DELIVERY',
    budget_ceiling_inr: 800,
    sla_max_minutes: 30,
    headcount: 1,
    target_dietary_profiles: [],
    items_requested: [{ query: 'biryani', serving_target: 1 }],
    client_coordinates: { lat: 12.9716, lng: 77.6412 },
  };
}

export async function makeAuction(
  pool: pg.Pool,
  dinerId: string,
  o: { createdAgoSeconds?: number; intent?: object } = {},
): Promise<string> {
  const intent = (o.intent ?? defaultIntent()) as DeliveryIntent;
  const { rows } = await pool.query(
    `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload,
       budget_ceiling_inr, max_sla_minutes, delivery_location, created_at)
     VALUES ($1, 'fixture', $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
       now() - make_interval(secs => $7))
     RETURNING id`,
    [
      dinerId,
      JSON.stringify(intent),
      intent.budget_ceiling_inr,
      intent.sla_max_minutes,
      intent.client_coordinates.lng,
      intent.client_coordinates.lat,
      o.createdAgoSeconds ?? 0,
    ],
  );
  return rows[0].id as string;
}
