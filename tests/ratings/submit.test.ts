import { getPool, runMigrations } from '@/lib/db/client';
import { SubmitRatingSchema } from '@/lib/ratings/schema';
import { submitVerifiedRating } from '@/lib/ratings/submit';
import { issueSession } from '@/lib/auth/session';
import { POST } from '@/app/api/ratings/route';
import { makeRestaurant, makeUser } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

async function completedOrder(diner: string, settledSqlAgo: string | null, rid?: string) {
  const restaurant = rid ?? await makeRestaurant(pool);
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at)
     VALUES ($1, $2, 'completed', NOW() - $3::interval) RETURNING id`,
    [restaurant, diner, settledSqlAgo ?? '0 seconds']);
  return { orderId: rows[0].id as string, restaurant };
}

const input = (orderId: string, extra: object = {}) => ({ order_ref_id: orderId, rating_score: 5, review_tags: ['Fast Prep' as const], ...extra });

test('accepts a rating submitted immediately after settlement', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, null);
  const r = await submitVerifiedRating(pool, diner, input(orderId));
  expect(r.ok).toBe(true);
});

test('rejects a rating submitted 2.5 seconds after settlement (Review Focus 5)', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, '2500 milliseconds');
  expect(await submitVerifiedRating(pool, diner, input(orderId))).toEqual({ ok: false, code: 'WINDOW_EXPIRED' });
  const { rowCount } = await pool.query(`SELECT 1 FROM verified_customer_ratings WHERE order_ref_id = $1`, [orderId]);
  expect(rowCount).toBe(0);
});

test('rejects a rating with no completed order (Review Focus 5)', async () => {
  const diner = await makeUser(pool);
  const rid = await makeRestaurant(pool);
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status) VALUES ($1, $2, 'open') RETURNING id`, [rid, diner]);
  expect(await submitVerifiedRating(pool, diner, input(rows[0].id))).toEqual({ ok: false, code: 'ORDER_NOT_COMPLETED' });
});

test('another diner cannot rate an order they do not own (Review Focus 5)', async () => {
  const owner = await makeUser(pool);
  const intruder = await makeUser(pool);
  const { orderId } = await completedOrder(owner, null);
  expect(await submitVerifiedRating(pool, intruder, input(orderId))).toEqual({ ok: false, code: 'ORDER_NOT_FOUND' });
});

test('one rating per order', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, null);
  expect((await submitVerifiedRating(pool, diner, input(orderId))).ok).toBe(true);
  expect(await submitVerifiedRating(pool, diner, input(orderId))).toEqual({ ok: false, code: 'ALREADY_RATED' });
});

test('schema rejects out-of-range stars, fractional stars, and unknown tags', () => {
  const base = { order_ref_id: '00000000-0000-4000-8000-000000000000', rating_score: 3, review_tags: [] };
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 0 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 6 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 3.5 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, review_tags: ['Great Vibes'] }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, review_tags: ['Fast Prep', 'Fast Prep'] }).success).toBe(false);
});

test('route returns 401 without a session', async () => {
  const res = await POST(new Request('http://localhost:3000/api/ratings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
  expect(res.status).toBe(401);
});

test('route returns 422 for the window rule and 201 inside it', async () => {
  const diner = await makeUser(pool, 'diner');
  const token = (await issueSession({ id: diner, role: 'diner' })).token;
  const late = await completedOrder(diner, '3 seconds');
  const ok = await completedOrder(diner, null);
  const call = (orderId: string) => POST(new Request('http://localhost:3000/api/ratings', {
    method: 'POST',
    headers: { cookie: `fos_session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input(orderId)),
  }));
  expect((await call(late.orderId)).status).toBe(422);
  expect((await call(ok.orderId)).status).toBe(201);
});
