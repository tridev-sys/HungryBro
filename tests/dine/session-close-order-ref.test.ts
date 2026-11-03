import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { seedDineRestaurant, seedMenu } from '@/tests/helpers/seed';
import { openTableSession, requestSplit, refreshSettlement } from '@/lib/dine/repository';
import { FakePaymentIntentAdapter } from '@/lib/payments/fake';
import { randomInt } from 'node:crypto';

const pool = await getPool();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); });

async function seedDiner(): Promise<string> {
  const { rows } = await getAdminPool().query(
    `INSERT INTO users (phone_number, role) VALUES ($1, 'diner') RETURNING id`,
    ['+919' + String(randomInt(100_000_000, 999_999_999))]);
  return rows[0].id;
}

async function closeOneLineSession(userId: string | undefined) {
  const adapter = new FakePaymentIntentAdapter();
  const t = await seedDineRestaurant(getAdminPool(), { withSession: false });
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const opened = await openTableSession(pool, {
    restaurantId: t.restaurantId, tableNumber: t.tableNumber, signature: t.signature, userId,
  });
  await getAdminPool().query(
    `INSERT INTO tabletop_order_lines (session_id, restaurant_id, menu_item_id, station, name, unit_price, quantity)
     VALUES ($1, $2, $3, 'Pantry', 'Lassi', 80, 1)`, [opened.sessionId, t.restaurantId, m.lassi]);
  const r = await requestSplit(pool, adapter, { sessionToken: opened.sessionToken, strategy: 'EQUAL', contributorCount: 1 });
  adapter.settle(r.shares[0].intentId);
  const done = await refreshSettlement(pool, adapter, { sessionToken: opened.sessionToken });
  return { t, opened, done };
}

test('a logged-in diner session writes one completed order_refs row at close', async () => {
  const diner = await seedDiner();
  const { t, opened, done } = await closeOneLineSession(diner);
  expect(done.status).toBe('closed');
  const { rows: sess } = await getAdminPool().query('SELECT closed_at FROM tabletop_sessions WHERE id = $1', [opened.sessionId]);
  const { rows: refs } = await getAdminPool().query(
    `SELECT restaurant_id, diner_user_id, session_id, status, settled_at FROM order_refs WHERE session_id = $1`,
    [opened.sessionId]);
  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({
    status: 'completed', diner_user_id: diner, restaurant_id: t.restaurantId, session_id: opened.sessionId,
  });
  expect(new Date(refs[0].settled_at).getTime()).toBe(new Date(sess[0].closed_at).getTime());
});

test('a guest session writes no order_refs row at close', async () => {
  const { opened, done } = await closeOneLineSession(undefined);
  expect(done.status).toBe('closed');
  const { rows } = await getAdminPool().query('SELECT 1 FROM order_refs WHERE session_id = $1', [opened.sessionId]);
  expect(rows).toHaveLength(0);
});
