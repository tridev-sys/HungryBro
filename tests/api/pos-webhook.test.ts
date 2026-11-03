import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { POST } from '@/app/api/pos/[provider]/[restaurantId]/route';
import { createRestaurant, ensureAppLogin } from '../helpers/db';

const pool = getAdminPool();
beforeAll(async () => { await runMigrations(pool); await ensureAppLogin(pool); });
afterAll(async () => { await pool.end(); });

const raw = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menuBody = raw('petpooja-menu.json');
const stockBody = raw('petpooja-stock-webhook.json');

function call(provider: string, rid: string, body: string, sig?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== undefined) headers['x-petpooja-signature'] = sig;
  const req = new Request(`http://localhost:3000/api/pos/${provider}/${rid}`, { method: 'POST', headers, body });
  return POST(req, { params: Promise.resolve({ provider, restaurantId: rid }) });
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

test('valid signed menu sync upserts rows and returns 200', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  const res = await call('petpooja', rid, menuBody, sign(menuBody, 's1'));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, result: 'menu' });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [rid]);
  expect(rows[0].n).toBe(4);
});

test('forged signature returns 401 and changes no rows (Review Focus 1)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  await call('petpooja', rid, menuBody, sign(menuBody, 's1'));
  const before = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 ORDER BY pos_item_code', [rid]);
  const res = await call('petpooja', rid, stockBody, sign(stockBody, 'attacker'));
  expect(res.status).toBe(401);
  const after = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 ORDER BY pos_item_code', [rid]);
  expect(after.rows).toEqual(before.rows);
});

test('missing signature returns 401 even for a restaurant with no secret configured', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  expect((await call('petpooja', rid, stockBody)).status).toBe(401);
});

test('unknown restaurant or provider mismatch returns 404', async () => {
  const rid = await createRestaurant(pool, { provider: 'restroworks', credentials: { webhook_secret: 's1' } });
  expect((await call('petpooja', rid, stockBody, sign(stockBody, 's1'))).status).toBe(404);
  expect((await call('petpooja', '00000000-0000-0000-0000-000000000000', stockBody, sign(stockBody, 's1'))).status).toBe(404);
  expect((await call('petpooja', 'not-a-uuid', stockBody, sign(stockBody, 's1'))).status).toBe(404);
});

test('valid signature with a malformed payload returns 400', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  const bad = '{"event":"menu.sync"}';
  expect((await call('petpooja', rid, bad, sign(bad, 's1'))).status).toBe(400);
});
