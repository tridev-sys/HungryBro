import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { loadRestaurantMenu } from '@/lib/delivery-customer/menu';
import { ensureAppLogin, makeRestaurant } from '../helpers/db';

const admin = getAdminPool();

beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
});
afterAll(async () => { await admin.end(); });

async function item(restaurantId: string, name: string, price: string, inStock = true, category: string | null = null) {
  await admin.query(
    `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary, is_in_stock)
     VALUES ($1, $2, $3, $4, $5, 'pure_veg', $6)`,
    [restaurantId, category, `code-${name}-${Math.random()}`, name, price, inStock]);
}

test('returns in-stock items with numeric NUMERIC(10,2) prices, grouped by category', async () => {
  const r = await makeRestaurant(pool());
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = TRUE, name = $2 WHERE id = $1', [r, 'Menu House']);
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name, station, display_order) VALUES ($1, 'Mains', 'Curry', 1) RETURNING id`, [r]);
  await item(r, 'Paneer', '250.50', true, rows[0].id);
  await item(r, 'Sold out thing', '99.00', false, rows[0].id);
  await item(r, 'Water', '20.00', true, null);

  const menu = await loadRestaurantMenu(await getPool(), r);
  expect(menu).not.toBeNull();
  expect(menu!.restaurant.name).toBe('Menu House');
  const names = menu!.items.map((i) => i.name).sort();
  expect(names).toEqual(['Paneer', 'Water']);
  const paneer = menu!.items.find((i) => i.name === 'Paneer')!;
  expect(paneer.priceInr).toBe(250.5);
  expect(paneer.categoryName).toBe('Mains');
  expect(menu!.items.find((i) => i.name === 'Water')!.categoryName).toBe('Other');
});

test('returns null for a restaurant that does not accept delivery', async () => {
  const r = await makeRestaurant(pool());
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = FALSE WHERE id = $1', [r]);
  expect(await loadRestaurantMenu(await getPool(), r)).toBeNull();
});

test('returns null for an unknown restaurant id', async () => {
  expect(await loadRestaurantMenu(await getPool(), '00000000-0000-4000-8000-000000000000')).toBeNull();
});

function pool() { return admin; }
