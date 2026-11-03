import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { asSession } from '@/lib/db/session';
import { seedDineRestaurant, seedMenu } from '@/tests/helpers/seed';
import { openTableSession, requestSplit, refreshSettlement } from '@/lib/dine/repository';
import { FakePaymentIntentAdapter } from '@/lib/payments/fake';

const pool = await getPool();
const adapter = new FakePaymentIntentAdapter();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); });

async function addLine(sessionId: string, restaurantId: string, menuItemId: string, station: string, name: string, price: number) {
  await getAdminPool().query(
    `INSERT INTO tabletop_order_lines (session_id, restaurant_id, menu_item_id, station, name, unit_price, quantity)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`, [sessionId, restaurantId, menuItemId, station, name, price]);
}

test('opening the same table twice returns the same active session', async () => {
  const t = await seedDineRestaurant(getAdminPool(), { withSession: false });
  const input = { restaurantId: t.restaurantId, tableNumber: t.tableNumber, signature: t.signature };
  const first = await openTableSession(pool, input);
  const second = await openTableSession(pool, input);
  expect(first.status).toBe('active');
  expect(second.sessionId).toBe(first.sessionId);
  expect(second.sessionToken).toBe(first.sessionToken);
});

test('a wrong table signature is rejected (Review Focus 2)', async () => {
  const t = await seedDineRestaurant(getAdminPool(), { withSession: false });
  await expect(openTableSession(pool, {
    restaurantId: t.restaurantId, tableNumber: t.tableNumber, signature: '1'.repeat(32),
  })).rejects.toThrow('INVALID_SIGNATURE');
});

test('a split request moves the session to payment_pending with one UPI intent per share', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await addLine(t.sessionId!, t.restaurantId, m.paneerTikka, 'Tandoor', 'Paneer Tikka', 400);
  await addLine(t.sessionId!, t.restaurantId, m.naan, 'Tandoor', 'Naan', 60);
  await addLine(t.sessionId!, t.restaurantId, m.lassi, 'Pantry', 'Lassi', 80);
  const r = await requestSplit(pool, adapter, { sessionToken: t.sessionToken!, strategy: 'EQUAL', contributorCount: 2 });
  expect(r.subtotal).toBe(540);
  expect(r.gst).toBe(27);
  expect(r.total).toBe(567);
  expect(r.shares.map((s) => s.amount)).toEqual([283.5, 283.5]);
  expect(r.shares[0].upiUri).toContain('am=283.50');
  const { rows } = await getAdminPool().query(`SELECT status FROM tabletop_sessions WHERE id = $1`, [t.sessionId]);
  expect(rows[0].status).toBe('payment_pending');
});

test('the session closes only after every share settles, and a closed session cannot reopen', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await addLine(t.sessionId!, t.restaurantId, m.lassi, 'Pantry', 'Lassi', 80);
  const r = await requestSplit(pool, adapter, { sessionToken: t.sessionToken!, strategy: 'EQUAL', contributorCount: 2 });
  adapter.settle(r.shares[0].intentId);
  const partial = await refreshSettlement(pool, adapter, { sessionToken: t.sessionToken! });
  expect(partial).toEqual({ status: 'payment_pending', paidShares: 1, totalShares: 2 });
  adapter.settle(r.shares[1].intentId);
  const done = await refreshSettlement(pool, adapter, { sessionToken: t.sessionToken! });
  expect(done.status).toBe('closed');
  const { rows } = await asSession(pool, { sessionToken: t.sessionToken! }, (c) =>
    c.query(`SELECT status, closed_at FROM tabletop_sessions WHERE id = $1`, [t.sessionId]));
  expect(rows[0].closed_at).not.toBeNull();
  await expect(requestSplit(pool, adapter, { sessionToken: t.sessionToken!, strategy: 'EQUAL', contributorCount: 2 }))
    .rejects.toThrow('SESSION_NOT_OPEN');
});
