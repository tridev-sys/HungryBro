import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { listDeliveryRestaurants } from '@/lib/delivery-customer/restaurants';
import { ensureAppLogin, makeRestaurant } from '../helpers/db';

const admin = getAdminPool();

beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
});
afterAll(async () => { await admin.end(); });

async function named(name: string, opts: { accepting?: boolean; reviews?: number } = {}) {
  const id = await makeRestaurant(admin);
  await admin.query(
    `UPDATE restaurant_nodes SET name = $2, is_accepting_delivery = $3,
            total_verified_reviews = $4, rating_aggregate = $5 WHERE id = $1`,
    [id, name, opts.accepting ?? true, opts.reviews ?? 0, opts.reviews ? 4.2 : 0]);
  return id;
}

test('lists only restaurants accepting delivery, sorted by name', async () => {
  const closedName = `Closed ${Date.now()}`;
  const b = await named(`Bravo ${Date.now()}`);
  const a = await named(`Alpha ${Date.now()}`);
  await named(closedName, { accepting: false });

  const rows = await listDeliveryRestaurants(await getPool());
  const ids = rows.map((r) => r.id);
  expect(ids).toContain(a);
  expect(ids).toContain(b);
  expect(rows.some((r) => r.name === closedName)).toBe(false);
  const mine = rows.filter((r) => r.id === a || r.id === b).map((r) => r.id);
  expect(mine).toEqual([a, b].sort((x, y) => {
    const nx = rows.find((r) => r.id === x)!.name;
    const ny = rows.find((r) => r.id === y)!.name;
    return nx.localeCompare(ny);
  }));
});

test('shows "No ratings yet" when a restaurant has no verified reviews', async () => {
  const id = await named(`Fresh ${Date.now()}`, { reviews: 0 });
  const row = (await listDeliveryRestaurants(await getPool())).find((r) => r.id === id)!;
  expect(row.ratingText).toBe('No ratings yet');
  expect(row.ratingAggregate).toBe(0);
});

test('shows the verified rating text when reviews exist', async () => {
  const id = await named(`Rated ${Date.now()}`, { reviews: 3 });
  const row = (await listDeliveryRestaurants(await getPool())).find((r) => r.id === id)!;
  expect(row.ratingText).toBe('4.2/5.0, 3 verified');
});
