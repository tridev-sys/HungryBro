// Check 6: rating abuse. Rejections must come from the database (the insert policy in migration 004),
// not only from app code. Direct inserts run as food_app_login with the diner's session set, and are
// rolled back, so the attempts that the database should refuse leave no rows.
import { POST as ratingsPOST } from '@/app/api/ratings/route';
import { prepareDatabase, closeAll, admin, buildWorld, type World, asApp, attempt, denied, makeOrder, sessionCookie, jsonRequest } from './helpers';

let w: World;
beforeAll(async () => {
  await prepareDatabase();
  w = await buildWorld();
});
afterAll(closeAll);

const submit = async (orderId: string, userId: string) =>
  ratingsPOST(jsonRequest('http://localhost:3000/api/ratings', { order_ref_id: orderId, rating_score: 5 },
    { cookie: await sessionCookie(userId, 'diner') }));

// Parameters: $1 restaurant_id, $2 diner_user_id, $3 order_ref_id. The score is fixed at 5.
const RATING_SQL = `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score)
  VALUES ($1, $2, $3, 5)`;

const ratingCount = async (orderId: string): Promise<number> =>
  (await admin.query('SELECT count(*)::int AS n FROM verified_customer_ratings WHERE order_ref_id = $1', [orderId])).rows[0].n;

describe('rating for an order that is not completed', () => {
  test('route refuses an open order with 409 and writes nothing', async () => {
    const res = await submit(w.dinerAOrderOpen, w.dinerA);
    expect(res.status).toBe(409);
    expect(await ratingCount(w.dinerAOrderOpen)).toBe(0);
  });

  test('the database refuses a rating insert for an open order', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const r = await attempt(c, RATING_SQL, [w.rX, w.dinerA, w.dinerAOrderOpen]);
      expect(denied(r)).toBe(true);
      expect(r.error ?? '').toMatch(/row-level security/);
    });
  });
});

describe('rating after the 2-second window', () => {
  test('route refuses an order settled 10 seconds ago with 422', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 10 });
    const res = await submit(order, w.dinerA);
    expect(res.status).toBe(422);
    expect(await ratingCount(order)).toBe(0);
  });

  test('the database refuses a rating 3 seconds after settlement (default created_at)', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 3 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const r = await attempt(c, RATING_SQL, [w.rX, w.dinerA, order]);
      expect(denied(r)).toBe(true);
    });
  });

  test('the database refuses a backdated created_at that makes an old order look inside the window', async () => {
    // Settled an hour ago. The insert policy compares created_at to settled_at + 2 s, so a client that
    // supplies created_at could pass. The window must hold regardless of the value the client sends.
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 3600 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const settled = (await c.query('SELECT settled_at FROM order_refs WHERE id = $1', [order])).rows[0].settled_at;
      const r = await attempt(c,
        `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score, created_at)
         VALUES ($1, $2, $3, 5, $4)`,
        [w.rX, w.dinerA, order, settled]);
      expect(denied(r)).toBe(true);
    });
    expect(await ratingCount(order)).toBe(0);
  });
});

describe('rating by someone who is not the diner', () => {
  test('route: diner A cannot rate diner B completed order (404, nothing written)', async () => {
    const res = await submit(w.dinerBOrderDone, w.dinerA);
    expect(res.status).toBe(404);
    expect(await ratingCount(w.dinerBOrderDone)).toBe(1); // only the fixture rating
  });

  test('database: diner A cannot insert a rating attributed to diner B', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rY, dinerId: w.dinerB, status: 'completed', settledSecondsAgo: 0 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const r = await attempt(c, RATING_SQL, [w.rY, w.dinerB, order]);
      expect(denied(r)).toBe(true);
    });
    expect(await ratingCount(order)).toBe(0);
  });

  test('database: diner A cannot rate diner B order under its own id', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rY, dinerId: w.dinerB, status: 'completed', settledSecondsAgo: 0 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const r = await attempt(c, RATING_SQL, [w.rY, w.dinerA, order]);
      expect(denied(r)).toBe(true);
    });
    expect(await ratingCount(order)).toBe(0);
  });

  test('database: a rating cannot be filed against a different restaurant than the order', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 0 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const r = await attempt(c, RATING_SQL, [w.rY, w.dinerA, order]);
      expect(denied(r)).toBe(true);
    });
    expect(await ratingCount(order)).toBe(0);
  });
});

describe('fake completed order chain', () => {
  test('a diner cannot close their own table session (status is server-owned)', async () => {
    await asApp({ userId: w.dinerA, sessionToken: w.xDining.sessionToken }, async (c) => {
      const close = await attempt(c, `UPDATE tabletop_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`, [w.xDining.sessionId]);
      expect(denied(close)).toBe(true);
    });
    expect((await admin.query('SELECT status FROM tabletop_sessions WHERE id = $1', [w.xDining.sessionId])).rows[0].status).toBe('active');
  });

  test('a diner cannot create a completed order and rate it, even in one transaction', async () => {
    // Diner A has an active session at restaurant X. Every step of the chain must be refused.
    let rated: boolean | null = null;
    await asApp({ userId: w.dinerA, sessionToken: w.xDining.sessionToken }, async (c) => {
      await attempt(c, `UPDATE tabletop_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`, [w.xDining.sessionId]);
      const order = await attempt(c,
        `INSERT INTO order_refs (restaurant_id, diner_user_id, session_id, status, settled_at)
         VALUES ($1, $2, $3, 'completed', NOW())`,
        [w.rX, w.dinerA, w.xDining.sessionId]);
      if (order.error) {
        rated = false;
        return;
      }
      const orderId = (await c.query(
        `SELECT id FROM order_refs WHERE session_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
        [w.xDining.sessionId])).rows[0].id;
      rated = !denied(await attempt(c, RATING_SQL, [w.rX, w.dinerA, orderId]));
    });
    expect(rated).toBe(false);
  }, 60_000);
});

describe('database value checks on ratings', () => {
  test('a score outside 1 to 5 is refused by the database', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 0 });
    await asApp({ userId: w.dinerA }, async (c) => {
      const zero = await attempt(c, `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, 0)`, [w.rX, w.dinerA, order]);
      const six = await attempt(c, `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, 6)`, [w.rX, w.dinerA, order]);
      expect(denied(zero)).toBe(true);
      expect(denied(six)).toBe(true);
    });
  });

  test('a second rating for the same order is refused (route 409 or window 422, never 201)', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rY, dinerId: w.dinerB, status: 'completed', settledSecondsAgo: 0 });
    const first = await submit(order, w.dinerB);
    expect(first.status).toBe(201);
    const second = await submit(order, w.dinerB);
    expect([409, 422]).toContain(second.status);
    expect(await ratingCount(order)).toBe(1);
  });

  test('control: the diner can rate their own completed order inside the window (201)', async () => {
    const order = await makeOrder(admin, { restaurantId: w.rX, dinerId: w.dinerA, status: 'completed', settledSecondsAgo: 0 });
    const res = await submit(order, w.dinerA);
    expect(res.status).toBe(201);
    expect(await ratingCount(order)).toBe(1);
  });
});
