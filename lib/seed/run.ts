import type pg from 'pg';
import { issueSignatureToken } from '../dine/signature';
import { CATEGORIES, FIXTURE_ITEMS, FIXTURE_RESTAURANTS, fixedUuid } from './fixtures';

export interface SeedOptions {
  nodeEnv?: string;
  allowProd?: boolean;
  /**
   * Test-only (opt-in, off by default): one restaurant_staff user per fixture restaurant, so sandbox
   * kitchens can bid in the delivery auction. scripts/seed.ts never sets this.
   */
  staffUsers?: boolean;
}

export interface SeedResult {
  restaurants: number;
  menuItems: number;
  tables: number;
}

/**
 * Idempotent seed, run on the admin pool and switched to food_admin inside one transaction
 * (food_admin bypasses RLS, which is intended for seeding). Re-runs keep each table's QR signature.
 */
export async function runSeed(pool: pg.Pool, opts: SeedOptions = {}): Promise<SeedResult> {
  if (opts.nodeEnv === 'production' && opts.allowProd !== true) {
    throw new Error('refusing to seed production (set ALLOW_SEED_PROD=yes)');
  }
  const result: SeedResult = { restaurants: 0, menuItems: 0, tables: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE food_admin');
    for (const [idx, r] of FIXTURE_RESTAURANTS.entries()) {
      const n = idx + 1;
      await client.query(
        `INSERT INTO restaurant_nodes (id, slug, name, fssai_license_number, gstin, location)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug, name = EXCLUDED.name, fssai_license_number = EXCLUDED.fssai_license_number,
           gstin = EXCLUDED.gstin, location = EXCLUDED.location`,
        [r.id, r.slug, r.name, r.fssai, r.gstin, r.lng, r.lat],
      );
      result.restaurants++;

      const stationToCategory = new Map<string, string>();
      for (const c of CATEGORIES) {
        const categoryId = fixedUuid(n, c.k);
        stationToCategory.set(c.station, categoryId);
        await client.query(
          `INSERT INTO menu_categories (id, restaurant_id, name, station, display_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, station = EXCLUDED.station, display_order = EXCLUDED.display_order`,
          [categoryId, r.id, c.name, c.station, c.k],
        );
      }

      for (const item of Object.values(FIXTURE_ITEMS)) {
        await client.query(
          `INSERT INTO menu_items (id, restaurant_id, category_id, pos_item_code, name, base_price, dietary)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (restaurant_id, pos_item_code) DO UPDATE SET
             category_id = EXCLUDED.category_id, name = EXCLUDED.name,
             base_price = EXCLUDED.base_price, dietary = EXCLUDED.dietary`,
          [r.id, stationToCategory.get(item.station) ?? null, item.code, item.name, item.basePrice, item.dietary],
        );
        result.menuItems++;
      }

      if (opts.staffUsers === true) {
        // Deterministic phone per fixture restaurant, outside the random range the journey seed uses.
        await client.query(
          `INSERT INTO users (phone_number, full_name, role, restaurant_id)
           VALUES ($1, $2, 'restaurant_staff', $3)
           ON CONFLICT (phone_number) DO UPDATE SET role = EXCLUDED.role, restaurant_id = EXCLUDED.restaurant_id`,
          [`+919${String(n).padStart(9, '0')}`, `${r.name} staff`, r.id],
        );
      }

      for (const number of r.tables) {
        await client.query(
          `INSERT INTO dining_tables (id, restaurant_id, table_number, seating_capacity, current_signature_token)
           VALUES (gen_random_uuid(), $1, $2, 4, $3)
           ON CONFLICT (restaurant_id, table_number) DO UPDATE SET
             current_signature_token = COALESCE(dining_tables.current_signature_token, EXCLUDED.current_signature_token)`,
          [r.id, number, issueSignatureToken()],
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

/** table_number -> current_signature_token for one restaurant (used by the E2E specs). */
export async function tableSignatures(pool: pg.Pool, restaurantId: string): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ table_number: string; current_signature_token: string }>(
    'SELECT table_number, current_signature_token FROM dining_tables WHERE restaurant_id = $1',
    [restaurantId],
  );
  return Object.fromEntries(rows.map((r) => [r.table_number, r.current_signature_token]));
}
