import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { seedDineRestaurant, seedMenu, seedStaff } from '@/tests/helpers/seed';
import { applyCartUpdate, listSessionTickets } from '@/lib/dine/cart';
import { refreshKitchenLoad } from '@/lib/kds/load';

const pool = await getPool();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); });

const add = (menuItemId: string, quantity = 1, extra: object = {}) => ({
  order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: menuItemId, name: 'x', quantity, ...extra }],
});

test('adding items from two stations fires one ticket per station (md Route 3, station routing)', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const r = await applyCartUpdate(pool, {
    sessionToken: t.sessionToken!,
    body: { order_type: 'DINE_IN', action: 'ADD', items: [
      { item_id: m.paneerTikka, name: 'Paneer Tikka', quantity: 1, preparation_notes: 'No garlic/onion' },
      { item_id: m.lassi, name: 'Lassi', quantity: 2 },
    ] },
  });
  expect(r.tickets.map((x) => x.station).sort()).toEqual(['Pantry', 'Tandoor']);
  expect(r.tickets.every((x) => x.status === 'queued' && x.orderModality === 'DINE_IN')).toBe(true);
  expect(r.subtotal).toBe(560);
  expect(r.total).toBe(588);
});

test('client-supplied price and station are ignored (Review Focus 1)', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const r = await applyCartUpdate(pool, {
    sessionToken: t.sessionToken!,
    body: { order_type: 'DINE_IN', action: 'ADD', items: [
      { item_id: m.paneerTikka, name: 'Free Paneer', quantity: 1, station: 'Bar', base_price: 1, unit_price: 1 },
    ] },
  });
  expect(r.subtotal).toBe(400);
  expect(r.tickets[0].station).toBe('Tandoor');
  expect(r.tickets[0].items[0].name).toBe('Paneer Tikka');
});

test('REMOVE reduces the line and fires a voided ticket with negative quantity', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: add(m.naan, 2) });
  const r = await applyCartUpdate(pool, {
    sessionToken: t.sessionToken!,
    body: { order_type: 'DINE_IN', action: 'REMOVE', items: [{ item_id: m.naan, name: 'Naan', quantity: 1 }] },
  });
  expect(r.tickets[0].status).toBe('voided');
  expect(r.tickets[0].items[0].quantity).toBe(-1);
  expect(r.subtotal).toBe(60);
});

test('removing more than the line holds is rejected', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: add(m.naan, 1) });
  await expect(applyCartUpdate(pool, {
    sessionToken: t.sessionToken!,
    body: { order_type: 'DINE_IN', action: 'REMOVE', items: [{ item_id: m.naan, name: 'Naan', quantity: 5 }] },
  })).rejects.toThrow('QUANTITY_EXCEEDS_LINE');
});

test('a delivery order is rejected on the dine-in path', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await expect(applyCartUpdate(pool, {
    sessionToken: t.sessionToken!,
    body: { order_type: 'DELIVERY', action: 'ADD', items: [{ item_id: m.naan, name: 'Naan', quantity: 1 }] },
  })).rejects.toThrow('DINE_IN_ONLY');
});

test('an item from another restaurant is unknown here', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const other = await seedDineRestaurant(getAdminPool());
  const om = await seedMenu(getAdminPool(), other.restaurantId);
  await expect(applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: add(om.naan) }))
    .rejects.toThrow('UNKNOWN_ITEM');
});

test('another table token cannot change this session (Review Focus 2)', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const other = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await expect(applyCartUpdate(pool, { sessionToken: other.sessionToken!, body: add(m.naan) }))
    .rejects.toThrow('UNKNOWN_ITEM');
  const seen = await listSessionTickets(pool, other.sessionToken!);
  expect(seen).toEqual([]);
});

test('no cart change is accepted once the session is payment_pending', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: add(m.naan) });
  // Fixture: the runtime role can no longer set session status (migration 008). Admin sets the state.
  await getAdminPool().query(`UPDATE tabletop_sessions SET status = 'payment_pending' WHERE id = $1`, [t.sessionId]);
  await expect(applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: add(m.naan) }))
    .rejects.toThrow('SESSION_NOT_OPEN');
});

test('the kitchen load reflects open tickets once a staff path refreshes it (decision 2)', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: { order_type: 'DINE_IN', action: 'ADD', items: [
    { item_id: m.paneerTikka, name: 'a', quantity: 1 }, { item_id: m.lassi, name: 'b', quantity: 1 },
  ] } });
  const staff = await seedStaff(getAdminPool(), t.restaurantId);
  expect(await refreshKitchenLoad(pool, staff, t.restaurantId)).toBe(0.08);
  const { rows } = await pool.query(`SELECT active_kds_load::float8 AS load FROM restaurant_nodes WHERE id = $1`, [t.restaurantId]);
  expect(rows[0].load).toBe(0.08);
});
