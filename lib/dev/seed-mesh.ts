import type pg from 'pg';
import { DEV_DINER_PHONE } from '@/lib/delivery/diner';

// Dev and test seed for the mesh. Coordinates are approximate (tech-decisions: pilot areas).
// Idempotent: restaurants by slug, users by phone, menu items by pos_item_code.
const GSTIN = '29ABCDE1234F1Z5';

interface SeedRestaurant {
  slug: string;
  name: string;
  fssai: string;
  lat: number;
  lng: number;
  load: number;
  rating: number;
  menu: Array<[name: string, price: number, station: string]>;
  staffPhone: string;
}

const RESTAURANTS: SeedRestaurant[] = [
  {
    slug: 'meghna-foods', name: 'Meghna Foods', fssai: '10000000000001', lat: 12.9719, lng: 77.6408,
    load: 0.42, rating: 4.7, staffPhone: '+919000000011',
    menu: [['Chicken Biryani', 300, 'Curry'], ['Seekh Kebab', 180, 'Tandoor']],
  },
  {
    slug: 'empire-restaurant', name: 'Empire Restaurant', fssai: '10000000000002', lat: 12.925, lng: 77.641,
    load: 0.68, rating: 4.6, staffPhone: '+919000000012',
    menu: [['Chicken Biryani', 300, 'Curry'], ['Seekh Kebab', 170, 'Tandoor']],
  },
  {
    slug: 'hsr-busy-kitchen', name: 'HSR Busy Kitchen', fssai: '10000000000003', lat: 12.97, lng: 77.63,
    load: 0.91, rating: 4.1, staffPhone: '+919000000013',
    menu: [['Chicken Biryani', 280, 'Curry'], ['Seekh Kebab', 160, 'Tandoor']],
  },
];

async function ensureCategory(pool: pg.Pool, restaurantId: string, station: string): Promise<string> {
  const found = await pool.query(
    'SELECT id FROM menu_categories WHERE restaurant_id = $1 AND station = $2 LIMIT 1',
    [restaurantId, station],
  );
  if (found.rows[0]) return found.rows[0].id as string;
  const ins = await pool.query(
    'INSERT INTO menu_categories (restaurant_id, name, station) VALUES ($1, $2, $2) RETURNING id',
    [restaurantId, station],
  );
  return ins.rows[0].id as string;
}

export async function seedMeshDev(pool: pg.Pool): Promise<void> {
  for (const r of RESTAURANTS) {
    await pool.query(
      `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location, active_kds_load, rating_aggregate)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8)
       ON CONFLICT (slug) DO NOTHING`,
      [r.slug, r.name, r.fssai, GSTIN, r.lng, r.lat, r.load, r.rating],
    );
    const { rows } = await pool.query('SELECT id FROM restaurant_nodes WHERE slug = $1', [r.slug]);
    const restaurantId = rows[0].id as string;

    await pool.query(
      `INSERT INTO users (phone_number, full_name, role, restaurant_id)
       VALUES ($1, $2, 'restaurant_staff', $3)
       ON CONFLICT (phone_number) DO NOTHING`,
      [r.staffPhone, `${r.name} staff`, restaurantId],
    );

    for (const [name, price, station] of r.menu) {
      const categoryId = await ensureCategory(pool, restaurantId, station);
      await pool.query(
        `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary, is_in_stock)
         VALUES ($1, $2, $3, $4, $5, 'non_veg', TRUE)
         ON CONFLICT (restaurant_id, pos_item_code) DO NOTHING`,
        [restaurantId, categoryId, `seed-${r.slug}-${name.toLowerCase().replace(/\s+/g, '-')}`, name, price],
      );
    }
  }

  await pool.query(
    `INSERT INTO users (phone_number, full_name, role)
     VALUES ($1, 'Dev Diner', 'diner')
     ON CONFLICT (phone_number) DO NOTHING`,
    [DEV_DINER_PHONE],
  );
}
