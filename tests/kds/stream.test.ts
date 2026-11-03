import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { seedDineRestaurant, seedMenu, seedStaff } from '@/tests/helpers/seed';
import { applyCartUpdate } from '@/lib/dine/cart';
import { issueSession } from '@/lib/auth/session';
import type { UserRole } from '@/types/food-os';
import { GET as staffStream } from '@/app/api/ops/[restaurantId]/kds/stream/route';
import { GET as dineStream } from '@/app/api/dine/stream/route';

const pool = await getPool();
beforeAll(async () => {
  await runMigrations(getAdminPool());
  process.env.AUTH_JWT_SECRET = 'test-only-secret-that-is-at-least-32-chars';
});
afterAll(async () => { await pool.end(); });

async function cookieFor(userId: string, role: UserRole): Promise<string> {
  const { token } = await issueSession({ id: userId, role });
  return `fos_session=${token}`;
}

async function readUntil(body: ReadableStream<Uint8Array>, needle: string, ms = 3000): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const timer = setTimeout(() => reader.cancel(), ms);
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  clearTimeout(timer);
  await reader.cancel();
  return text;
}

test('staff stream of the same restaurant sends a snapshot and then the fired ticket', async () => {
  const t = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), t.restaurantId);
  const staff = await seedStaff(getAdminPool(), t.restaurantId);
  const res = await staffStream(
    new Request(`http://x/api/ops/${t.restaurantId}/kds/stream`, { headers: { cookie: await cookieFor(staff, 'restaurant_staff') } }),
    { params: Promise.resolve({ restaurantId: t.restaurantId }) });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const pending = readUntil(res.body!, 'ticket.fired');
  await applyCartUpdate(pool, { sessionToken: t.sessionToken!, body: { order_type: 'DINE_IN', action: 'ADD',
    items: [{ item_id: m.naan, name: 'Naan', quantity: 1 }] } });
  expect(await pending).toContain('"type":"ticket.fired"');
});

test('a staff member of another restaurant gets 403', async () => {
  const x = await seedDineRestaurant(getAdminPool());
  const y = await seedDineRestaurant(getAdminPool());
  const staff = await seedStaff(getAdminPool(), x.restaurantId);
  const res = await staffStream(
    new Request('http://x', { headers: { cookie: await cookieFor(staff, 'restaurant_staff') } }),
    { params: Promise.resolve({ restaurantId: y.restaurantId }) });
  expect(res.status).toBe(403);
});

test('a request without a signed-in user gets 401', async () => {
  const x = await seedDineRestaurant(getAdminPool());
  const res = await staffStream(new Request('http://x'), { params: Promise.resolve({ restaurantId: x.restaurantId }) });
  expect(res.status).toBe(401);
});

test('the diner stream forwards only its own session events', async () => {
  const mine = await seedDineRestaurant(getAdminPool());
  const theirs = await seedDineRestaurant(getAdminPool(), { withSession: true });
  const m = await seedMenu(getAdminPool(), mine.restaurantId);
  const res = await dineStream(new Request('http://x/api/dine/stream', {
    headers: { cookie: `fos_table_session=${mine.sessionToken}` } }));
  expect(res.status).toBe(200);
  const pending = readUntil(res.body!, `"sessionId":"${mine.sessionId}"`);
  await applyCartUpdate(pool, { sessionToken: theirs.sessionToken!, body: { order_type: 'DINE_IN', action: 'ADD',
    items: [{ item_id: (await seedMenu(getAdminPool(), theirs.restaurantId)).naan, name: 'Naan', quantity: 1 }] } });
  await applyCartUpdate(pool, { sessionToken: mine.sessionToken!, body: { order_type: 'DINE_IN', action: 'ADD',
    items: [{ item_id: m.naan, name: 'Naan', quantity: 1 }] } });
  const text = await pending;
  expect(text).not.toContain(theirs.sessionId!);
  expect(text).toContain(mine.sessionId!);
});
