import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { seedDineRestaurant, seedMenu } from '@/tests/helpers/seed';
import { applyCartUpdate } from '@/lib/dine/cart';
import { loadBoard, bumpItem, bumpTicket } from '@/lib/kds/board';

const pool = await getPool();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); });

async function staffOf(restaurantId: string | null) {
  const { rows } = await getAdminPool().query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, 'restaurant_staff', $2) RETURNING id`,
    ['+919' + Math.floor(1e8 + Math.random() * 9e8), restaurantId]);
  return { userId: rows[0].id, role: 'restaurant_staff' as const, restaurantId };
}

async function firedTwoTandoor() {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const cart = await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: { order_type: 'DINE_IN', action: 'ADD', items: [
    { item_id: m.paneerTikka, name: 'a', quantity: 1 }, { item_id: m.naan, name: 'b', quantity: 1 },
  ] } });
  return { t, ticketId: cart.tickets[0].id };
}

test('bumping items walks the ticket from queued to in_prep to ready (Review Focus 5)', async () => {
  const { t, ticketId } = await firedTwoTandoor();
  const staff = await staffOf(t.restaurantId);
  const a = await bumpItem(pool, staff, { restaurantId: t.restaurantId, ticketId, itemIndex: 0 });
  expect(a.status).toBe('in_prep');
  expect(a.items[0].bumped).toBe(true);
  const b = await bumpItem(pool, staff, { restaurantId: t.restaurantId, ticketId, itemIndex: 1 });
  expect(b.status).toBe('ready');
});

test('bump ticket serves the ticket and removes it from the board', async () => {
  const { t, ticketId } = await firedTwoTandoor();
  const staff = await staffOf(t.restaurantId);
  const served = await bumpTicket(pool, staff, { restaurantId: t.restaurantId, ticketId });
  expect(served.status).toBe('served');
  expect(served.bumpedAt).not.toBeNull();
  const board = await loadBoard(pool, staff, t.restaurantId);
  expect(board.tickets.find((x) => x.id === ticketId)).toBeUndefined();
});

test('staff of another restaurant cannot bump the ticket (Review Focus 5)', async () => {
  const { t, ticketId } = await firedTwoTandoor();
  const other = await seedDineRestaurant(getAdminPool());
  const intruder = await staffOf(other.restaurantId);
  await expect(bumpItem(pool, intruder, { restaurantId: t.restaurantId, ticketId, itemIndex: 0 }))
    .rejects.toThrow('FORBIDDEN');
  await expect(bumpTicket(pool, intruder, { restaurantId: t.restaurantId, ticketId }))
    .rejects.toThrow('FORBIDDEN');
});

test('a served ticket cannot be bumped again (Review Focus 5)', async () => {
  const { t, ticketId } = await firedTwoTandoor();
  const staff = await staffOf(t.restaurantId);
  await bumpTicket(pool, staff, { restaurantId: t.restaurantId, ticketId });
  await expect(bumpItem(pool, staff, { restaurantId: t.restaurantId, ticketId, itemIndex: 0 }))
    .rejects.toThrow('INVALID_TRANSITION');
});

test('the board reports load and backpressure from open tickets', async () => {
  const { t } = await firedTwoTandoor();
  const staff = await staffOf(t.restaurantId);
  const board = await loadBoard(pool, staff, t.restaurantId);
  expect(board.load).toBe(0.04);
  expect(board.backpressure).toBe(false);
});
