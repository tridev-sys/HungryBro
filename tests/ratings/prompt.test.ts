// Database test for the rating prompt lookup: only the signed-in diner's own completed, unrated
// order of the session is returned.
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { findRatableOrderRef } from '@/lib/ratings/prompt';
import { openTableSession } from '@/lib/dine/repository';
import { seedDineRestaurant } from '@/tests/helpers/seed';
import { ensureAppLogin, makeUser } from '../helpers/db';

const admin = getAdminPool();
let pool: Awaited<ReturnType<typeof getPool>>;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(admin);
  await ensureAppLogin(admin);
  pool = await getPool();
});
afterAll(async () => { await pool.end(); await admin.end(); });

async function closedSessionWithOrder(diner: string) {
  const t = await seedDineRestaurant(admin, { withSession: false });
  const opened = await openTableSession(pool, {
    restaurantId: t.restaurantId, tableNumber: t.tableNumber, signature: t.signature, userId: diner,
  });
  const { rows } = await admin.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, session_id, status, settled_at)
     VALUES ($1, $2, $3, 'completed', NOW()) RETURNING id`,
    [t.restaurantId, diner, opened.sessionId]);
  return { orderId: rows[0].id as string, sessionId: opened.sessionId };
}

test('returns the diner own completed order for the session', async () => {
  const diner = await makeUser(admin, 'diner');
  const { orderId, sessionId } = await closedSessionWithOrder(diner);
  expect(await findRatableOrderRef(pool, diner, sessionId)).toBe(orderId);
});

test('returns null for another diner, for an unknown session, and once the order is rated', async () => {
  const owner = await makeUser(admin, 'diner');
  const stranger = await makeUser(admin, 'diner');
  const { orderId, sessionId } = await closedSessionWithOrder(owner);

  expect(await findRatableOrderRef(pool, stranger, sessionId)).toBeNull();
  expect(await findRatableOrderRef(pool, owner, '00000000-0000-4000-8000-0000000000bb')).toBeNull();

  const { rows: r } = await admin.query('SELECT restaurant_id FROM order_refs WHERE id = $1', [orderId]);
  await admin.query(
    `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score)
     VALUES ($1, $2, $3, 5)`,
    [r[0].restaurant_id, owner, orderId]);
  expect(await findRatableOrderRef(pool, owner, sessionId)).toBeNull();
});
