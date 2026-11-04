import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { seedDineRestaurant, seedMenu } from '@/tests/helpers/seed';
import { openTableSession, requestSplit, refreshSettlement } from '@/lib/dine/repository';
import { FakePaymentIntentAdapter } from '@/lib/payments/fake';
import { subscribeKdsEvents, type KdsEvent } from '@/lib/kds/events';
import { closeRedis } from '@/lib/redis';

const pool = await getPool();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); await closeRedis(); });

/** Opens a one-share session and lets the provider settle the share. Nothing is closed yet. */
async function settledShareSession() {
  const adapter = new FakePaymentIntentAdapter();
  const t = await seedDineRestaurant(getAdminPool(), { withSession: false });
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const opened = await openTableSession(pool, {
    restaurantId: t.restaurantId, tableNumber: t.tableNumber, signature: t.signature, userId: undefined,
  });
  await getAdminPool().query(
    `INSERT INTO tabletop_order_lines (session_id, restaurant_id, menu_item_id, station, name, unit_price, quantity)
     VALUES ($1, $2, $3, 'Pantry', 'Lassi', 80, 1)`, [opened.sessionId, t.restaurantId, m.lassi]);
  const r = await requestSplit(pool, adapter, { sessionToken: opened.sessionToken, strategy: 'EQUAL', contributorCount: 1 });
  adapter.settle(r.shares[0].intentId);
  return { adapter, restaurantId: t.restaurantId, sessionId: opened.sessionId, token: opened.sessionToken };
}

async function waitUntil(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for event');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('closing a session publishes session.settled on the restaurant channel', async () => {
  const { adapter, restaurantId, sessionId, token } = await settledShareSession();
  const received: KdsEvent[] = [];
  const stop = await subscribeKdsEvents(restaurantId, (e) => received.push(e));
  try {
    await new Promise((r) => setTimeout(r, 50)); // let the subscriber attach before the publish
    const done = await refreshSettlement(pool, adapter, { sessionToken: token });
    expect(done.status).toBe('closed');
    await waitUntil(() => received.some((e) => e.type === 'session.settled'));
    expect(received.find((e) => e.type === 'session.settled')).toEqual({
      type: 'session.settled', restaurantId, sessionId,
    });
  } finally {
    await stop();
  }
});

test('a refresh of an already closed session publishes nothing new', async () => {
  const { adapter, restaurantId, sessionId, token } = await settledShareSession();
  await refreshSettlement(pool, adapter, { sessionToken: token });

  const received: KdsEvent[] = [];
  const stop = await subscribeKdsEvents(restaurantId, (e) => received.push(e));
  try {
    await new Promise((r) => setTimeout(r, 50));
    const again = await refreshSettlement(pool, adapter, { sessionToken: token });
    expect(again.status).toBe('closed');
    await new Promise((r) => setTimeout(r, 150));
    expect(received.filter((e) => e.type === 'session.settled' && e.sessionId === sessionId)).toHaveLength(0);
  } finally {
    await stop();
  }
});
