import { createHash } from 'node:crypto';
import type pg from 'pg';
import { LatLngSchema, type LatLng } from '@/types/food-os';
import { haversineKm, offsetByKm } from '@/lib/geo/distance';
import { issueSignatureToken } from '../dine/signature';
import { CATEGORIES, FIXTURE_ITEMS } from './fixtures';

// Pilot geo seeder: mock restaurant nodes clustered 1.5 to 3.5 km around a centre point, so the
// nearby search can be exercised away from the fixed Indiranagar and HSR fixtures.
// Mock data must never reach real diners. Every guard below is enforced before any write.

/** The production database name. The seeder refuses it under every override. */
export const PILOT_PRODUCTION_DB_NAME = 'food_os';

/** Generation band. Inside the 1.5 to 3.5 km acceptance band, with margin for rounding. */
const GEN_MIN_KM = 1.6;
const GEN_MAX_KM = 3.4;
const PILOT_TABLES = ['01', '02'];

export interface PilotNode {
  index: number;
  id: string;
  slug: string;
  name: string;
  fssai: string;
  gstin: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

export type PilotEnv = Record<string, string | undefined>;

/** Deterministic UUID (version 4 shape) derived from a text key. */
function uuidFrom(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Small seeded PRNG (mulberry32). Same seed, same sequence. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (n: number) => Number(n.toFixed(6));

/**
 * Pure and deterministic: the same centre always yields the same 3 to 5 nodes, each 1.6 to 3.4 km
 * from the centre (inside the 1.5 to 3.5 km band after rounding to 6 decimal places).
 */
export function generatePilotNodes(centre: LatLng): PilotNode[] {
  const point = LatLngSchema.parse(centre);
  const key = `pilot-geo:${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`;
  const digest = createHash('sha256').update(key).digest();
  const rand = prng(digest.readUInt32BE(0));
  const count = 3 + (digest[4] % 3);
  const tag = digest.toString('hex').slice(8, 16);

  const nodes: PilotNode[] = [];
  for (let i = 0; i < count; i++) {
    const bearing = rand() * 360;
    const distance = GEN_MIN_KM + rand() * (GEN_MAX_KM - GEN_MIN_KM);
    const raw = offsetByKm(point, distance, bearing);
    const lat = round6(raw.lat);
    const lng = round6(raw.lng);
    const nodeKey = `${key}:node:${i}`;
    const numeric = createHash('sha256').update(nodeKey).digest().readBigUInt64BE(0);
    const digits = (numeric % 10n ** 13n).toString().padStart(13, '0');
    const gstinDigits = (numeric % 10n ** 8n).toString().padStart(8, '0');
    nodes.push({
      index: i,
      id: uuidFrom(nodeKey),
      slug: `pilot-geo-${tag}-${i + 1}`,
      name: `Pilot Kitchen ${i + 1} (Pilot Data)`,
      fssai: `9${digits}`,
      gstin: `99PILOT${gstinDigits}`,
      lat,
      lng,
      distanceKm: haversineKm(point, { lat, lng }),
    });
  }
  return nodes;
}

/**
 * Safety guard. Throws unless: PILOT_SEED_ENABLED=1; the target is not the production database
 * (checked by name, always); and, when NODE_ENV=production, PILOT_SEED_ALLOW_PROD=1 is also set.
 */
export function assertPilotSeedAllowed(env: PilotEnv, dbName: string): void {
  if (env.PILOT_SEED_ENABLED !== '1') {
    throw new Error('refusing pilot seed: set PILOT_SEED_ENABLED=1 to seed mock pilot restaurants');
  }
  if (dbName === PILOT_PRODUCTION_DB_NAME) {
    throw new Error(`refusing pilot seed: target is the production database "${PILOT_PRODUCTION_DB_NAME}"`);
  }
  if (env.NODE_ENV === 'production' && env.PILOT_SEED_ALLOW_PROD !== '1') {
    throw new Error('refusing pilot seed: NODE_ENV=production requires PILOT_SEED_ALLOW_PROD=1 as well');
  }
}

export interface PilotSeedResult {
  restaurants: number;
  menuItems: number;
  tables: number;
}

/**
 * Seeds the pilot nodes around `centre` into the database behind `pool` (run as food_admin in one
 * transaction, like runSeed). Re-running for the same centre updates the same rows.
 */
export async function runPilotSeed(pool: pg.Pool, centre: LatLng, env: PilotEnv = process.env): Promise<PilotSeedResult> {
  const point = LatLngSchema.parse(centre);
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  assertPilotSeedAllowed(env, rows[0].name);

  const nodes = generatePilotNodes(point);
  const result: PilotSeedResult = { restaurants: 0, menuItems: 0, tables: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE food_admin');
    for (const node of nodes) {
      await client.query(
        `INSERT INTO restaurant_nodes (id, slug, name, fssai_license_number, gstin, location)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug, name = EXCLUDED.name, fssai_license_number = EXCLUDED.fssai_license_number,
           gstin = EXCLUDED.gstin, location = EXCLUDED.location`,
        [node.id, node.slug, node.name, node.fssai, node.gstin, node.lng, node.lat],
      );
      result.restaurants++;

      const stationToCategory = new Map<string, string>();
      for (const c of CATEGORIES) {
        const categoryId = uuidFrom(`${node.id}:category:${c.k}`);
        stationToCategory.set(c.station, categoryId);
        await client.query(
          `INSERT INTO menu_categories (id, restaurant_id, name, station, display_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, station = EXCLUDED.station, display_order = EXCLUDED.display_order`,
          [categoryId, node.id, c.name, c.station, c.k],
        );
      }

      for (const item of Object.values(FIXTURE_ITEMS)) {
        await client.query(
          `INSERT INTO menu_items (id, restaurant_id, category_id, pos_item_code, name, base_price, dietary)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (restaurant_id, pos_item_code) DO UPDATE SET
             category_id = EXCLUDED.category_id, name = EXCLUDED.name,
             base_price = EXCLUDED.base_price, dietary = EXCLUDED.dietary`,
          [node.id, stationToCategory.get(item.station) ?? null, item.code, item.name, item.basePrice, item.dietary],
        );
        result.menuItems++;
      }

      for (const number of PILOT_TABLES) {
        await client.query(
          `INSERT INTO dining_tables (id, restaurant_id, table_number, seating_capacity, current_signature_token)
           VALUES (gen_random_uuid(), $1, $2, 4, $3)
           ON CONFLICT (restaurant_id, table_number) DO UPDATE SET
             current_signature_token = COALESCE(dining_tables.current_signature_token, EXCLUDED.current_signature_token)`,
          [node.id, number, issueSignatureToken()],
        );
        result.tables++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return result;
}
