// Test-only seed for the customer-journey specs. Runs in a throwaway container on the e2e-net
// network against a private Postgres. Every row uses a per-run suffix so slugs never collide.
// Writes the fixture file the specs read (ids, table signature, session cookie values). Nothing
// here is imported by the app.
import { randomBytes, randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { issueSession } from '@/lib/auth/session';

const FIXTURE_PATH = process.env.E2E_FIXTURE_FILE ?? '/out/fixtures.json';
const GSTIN = '29ABCDE1234F1Z5';
const phone = () => '+919' + String(randomInt(100_000_000, 999_999_999));
const fssai = () => String(randomInt(1e13, 1e14));

async function ensureAppLogin(admin: ReturnType<typeof getAdminPool>, appUrl: string): Promise<void> {
  const password = decodeURIComponent(new URL(appUrl).password);
  const c = await admin.connect();
  try {
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app_login') THEN
        CREATE ROLE food_app_login LOGIN;
      END IF;
    END $$`);
    await c.query(`ALTER ROLE food_app_login WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${c.escapeLiteral(password)}`);
    await c.query('GRANT food_app TO food_app_login');
  } finally {
    c.release();
  }
}

async function main(): Promise<void> {
  const admin = getAdminPool();
  await runMigrations(admin);
  await ensureAppLogin(admin, process.env.APP_DATABASE_URL ?? '');

  const run = randomBytes(3).toString('hex');

  async function restaurant(label: string, lat: number, lng: number, load: number, settlementVpa: string | null) {
    const { rows } = await admin.query(
      `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location, active_kds_load, settlement_vpa)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8)
       RETURNING id`,
      [`e2e-${label}-${run}`, `E2E ${label} ${run}`, fssai(), GSTIN, lng, lat, load, settlementVpa]);
    return { id: rows[0].id as string, name: `E2E ${label} ${run}` };
  }

  async function category(restaurantId: string, station: string): Promise<string> {
    const { rows } = await admin.query(
      'INSERT INTO menu_categories (restaurant_id, name, station) VALUES ($1, $2, $2) RETURNING id',
      [restaurantId, station]);
    return rows[0].id as string;
  }

  async function item(restaurantId: string, categoryId: string, code: string, name: string,
    price: number, dietary: string, tags: string[]) {
    await admin.query(
      `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary, allergen_tags, is_in_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], TRUE)`,
      [restaurantId, categoryId, `${code}-${run}`, name, price, dietary, tags]);
  }

  // Dine-in restaurant (also the KDS restaurant for staff A). Lat/lng are the Indiranagar pilot area.
  const dine = await restaurant('Spice Route', 12.9719, 77.6408, 0.42, 'e2e-settle@okaxis');
  const tandoor = await category(dine.id, 'Tandoor');
  const curry = await category(dine.id, 'Curry');
  const pantry = await category(dine.id, 'Pantry');
  await item(dine.id, tandoor, 'PT', 'Paneer Tikka', 400, 'jain', ['dairy']);
  await item(dine.id, tandoor, 'VS', 'Veg Seekh', 260, 'pure_veg', ['gluten']);
  await item(dine.id, curry, 'DM', 'Dal Makhani', 300, 'pure_veg', ['dairy']);
  await item(dine.id, curry, 'CB', 'Chicken Biryani', 320, 'non_veg', []);
  await item(dine.id, pantry, 'ML', 'Mango Lassi', 90, 'pure_veg', ['dairy']);
  // One table per journey so each journey gets its own session and its own tickets.
  const tables: Record<string, string> = {};
  for (const tableNumber of ['1', '2', '3']) {
    const sig = randomBytes(16).toString('hex');
    tables[tableNumber] = sig;
    await admin.query(
      'INSERT INTO dining_tables (restaurant_id, table_number, current_signature_token) VALUES ($1, $2, $3)',
      [dine.id, tableNumber, sig]);
  }

  // Second restaurant: staff B must not reach restaurant A's kitchen.
  const other = await restaurant('Other Kitchen', 12.9, 77.5, 0.10, null);

  // Delivery kitchens inside the 6 km radius, both under the 0.85 load cut-off.
  const kitchenAlpha = await restaurant('Kitchen Alpha', 12.9725, 77.6412, 0.42, 'e2e-alpha@okaxis');
  const kitchenBeta = await restaurant('Kitchen Beta', 12.9731, 77.6399, 0.68, 'e2e-beta@okaxis');
  for (const k of [kitchenAlpha, kitchenBeta]) {
    const c = await category(k.id, 'Curry');
    const t = await category(k.id, 'Tandoor');
    await item(k.id, c, 'BIR', 'Chicken Biryani', 300, 'non_veg', []);
    await item(k.id, t, 'KEB', 'Seekh Kebab', 180, 'non_veg', []);
    // Sandbox kitchens only bid when the restaurant has a staff user (runSandboxKitchens).
    await admin.query(
      `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, 'restaurant_staff', $2)`,
      [phone(), k.id]);
  }

  // Users and signed session cookies (the same HS256 token the sign-in flow issues).
  async function user(role: string, restaurantId: string | null) {
    const { rows } = await admin.query(
      'INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id',
      [phone(), role, restaurantId]);
    const id = rows[0].id as string;
    const { token } = await issueSession({ id, role: role as 'diner' | 'restaurant_staff' });
    return { id, token };
  }
  const diner = await user('diner', null);
  const staffA = await user('restaurant_staff', dine.id);
  const staffB = await user('restaurant_staff', other.id);

  const fixture = {
    run,
    dine: { restaurantId: dine.id, name: dine.name, tables },
    otherRestaurant: { restaurantId: other.id, name: other.name },
    kitchens: [
      { restaurantId: kitchenAlpha.id, name: kitchenAlpha.name },
      { restaurantId: kitchenBeta.id, name: kitchenBeta.name },
    ],
    menu: { paneerTikka: 'Paneer Tikka', vegSeekh: 'Veg Seekh', dalMakhani: 'Dal Makhani', chickenBiryani: 'Chicken Biryani', mangoLassi: 'Mango Lassi' },
    diner: { id: diner.id, sessionToken: diner.token },
    staffA: { id: staffA.id, sessionToken: staffA.token },
    staffB: { id: staffB.id, sessionToken: staffB.token },
  };
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture), { mode: 0o600 });
  await admin.end();
  console.log(`seed ok: run=${run} fixture written`);
}

main().catch((err) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
