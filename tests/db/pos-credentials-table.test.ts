import { getAdminPool, runMigrations } from '@/lib/db/client';
import { createRestaurant } from '../helpers/db';

const pool = getAdminPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

// Runs one query as the named role inside a transaction that is always rolled back.
// The role names below are literals in this file, never user input.
async function asDbRole(role: 'food_app' | 'food_sync', sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    return await c.query(sql, params);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

test('food_app cannot SELECT from restaurant_pos_credentials', async () => {
  await expect(asDbRole('food_app', 'SELECT count(*) FROM restaurant_pos_credentials'))
    .rejects.toThrow(/permission denied/);
});

test('food_sync can SELECT from restaurant_pos_credentials', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { api_key: 'k' } });
  const { rows } = await asDbRole('food_sync',
    'SELECT pos_provider, ciphertext FROM restaurant_pos_credentials WHERE restaurant_id = $1', [rid]);
  expect(rows).toHaveLength(1);
  expect(rows[0].pos_provider).toBe('petpooja');
  expect(JSON.stringify(rows[0].ciphertext)).not.toContain('api_key');
});

test('the app login gets no ciphertext from the POS function outside the verified webhook path', async () => {
  // Owner decision: only the POS webhook path (integration context for the same restaurant) reads
  // ciphertext. Staff, diners, and an anonymous app login get NULL.
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's' } });
  const { rows } = await asDbRole('food_app', 'SELECT app_pos_credentials_for_restaurant($1) AS c', [rid]);
  expect(rows[0].c).toBeNull();
});

test('a valid signed POS event on the webhook path reads the credentials through the function', async () => {
  const { createHmac } = await import('node:crypto');
  const { POST } = await import('@/app/api/pos/[provider]/[restaurantId]/route');
  const secret = `pos-fn-${Date.now()}`;
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: secret } });
  const body = JSON.stringify({ event: 'menu.sync', restID: 'PP-FN', categories: [
    { categoryname: 'Mains', items: [{ itemid: `fn-${Date.now()}`, itemname: 'Dal', price: '120', instock: '1' }] }] });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const res = await POST(new Request(`http://localhost:3000/api/pos/petpooja/${rid}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-petpooja-signature': sig }, body,
  }), { params: Promise.resolve({ provider: 'petpooja', restaurantId: rid }) });
  expect(res.status).toBe(200);
});

test('restaurant_nodes no longer has a pos_credentials column', async () => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'restaurant_nodes' AND column_name = 'pos_credentials'`);
  expect(rows).toHaveLength(0);
});
