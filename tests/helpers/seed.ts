// Test-only seed helpers. They run through the owner pool (superuser in tests), never as app code.
import type pg from 'pg';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export interface SeededDine {
  restaurantId: string;
  tableId: string;
  tableNumber: string;
  signature: string;
  sessionId: string | null;
  sessionToken: string | null;
}

const phone = () => '+919' + String(randomInt(100_000_000, 999_999_999));
const fssai = () => String(randomInt(1e13, 1e14));

export async function seedDineRestaurant(
  pool: pg.Pool,
  opts: { withSession?: boolean } = {},
): Promise<SeededDine> {
  const withSession = opts.withSession ?? true;
  const { rows: r } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location, settlement_vpa)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326), 'test@okaxis')
     RETURNING id`,
    [`d-${randomUUID()}`, fssai()]);
  const restaurantId: string = r[0].id;
  const signature = randomBytes(16).toString('hex');
  const { rows: t } = await pool.query(
    `INSERT INTO dining_tables (restaurant_id, table_number, current_signature_token)
     VALUES ($1, '1', $2) RETURNING id`,
    [restaurantId, signature]);
  const tableId: string = t[0].id;
  let sessionId: string | null = null;
  let sessionToken: string | null = null;
  if (withSession) {
    sessionToken = randomBytes(32).toString('hex');
    const { rows: s } = await pool.query(
      `INSERT INTO tabletop_sessions (table_id, session_token) VALUES ($1, $2) RETURNING id`,
      [tableId, sessionToken]);
    sessionId = s[0].id;
  }
  return { restaurantId, tableId, tableNumber: '1', signature, sessionId, sessionToken };
}

export async function seedStaff(pool: pg.Pool, restaurantId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, 'restaurant_staff', $2) RETURNING id`,
    [phone(), restaurantId]);
  return rows[0].id;
}

export async function seedMenu(pool: pg.Pool, restaurantId: string) {
  const stations = ['Tandoor', 'Curry', 'Pantry'] as const;
  const cat: Record<string, string> = {};
  for (const station of stations) {
    const { rows } = await pool.query(
      `INSERT INTO menu_categories (restaurant_id, name, station) VALUES ($1, $2, $2) RETURNING id`,
      [restaurantId, station]);
    cat[station] = rows[0].id;
  }
  const item = async (code: string, name: string, price: number, station: string,
    dietary: string, tags: string[]) => {
    const { rows } = await pool.query(
      `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary, allergen_tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[]) RETURNING id`,
      [restaurantId, cat[station], code, name, price, dietary, tags]);
    return rows[0].id as string;
  };
  return {
    paneerTikka: await item('PT-1', 'Paneer Tikka', 400, 'Tandoor', 'jain', ['dairy']),
    naan: await item('NAAN-1', 'Naan', 60, 'Tandoor', 'pure_veg', ['gluten']),
    lassi: await item('LASSI-1', 'Lassi', 80, 'Pantry', 'pure_veg', ['dairy']),
    dal: await item('DAL-1', 'Dal Makhani', 300, 'Curry', 'pure_veg', ['dairy']),
  };
}
