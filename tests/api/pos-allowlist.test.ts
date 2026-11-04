import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { POST } from '@/app/api/pos/[provider]/[restaurantId]/route';
import { createRestaurant, ensureAppLogin } from '../helpers/db';

const pool = getAdminPool();
beforeAll(async () => { await runMigrations(pool); await ensureAppLogin(pool); });
afterAll(async () => { await pool.end(); });

const saved = process.env.POS_PROVIDERS_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.POS_PROVIDERS_ENABLED;
  else process.env.POS_PROVIDERS_ENABLED = saved;
});

const menuBody = readFileSync(path.join(__dirname, '../fixtures/pos/petpooja-menu.json'), 'utf8');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

function call(provider: string, rid: string, body: string, sig?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== undefined) headers['x-petpooja-signature'] = sig;
  const req = new Request(`http://localhost:3000/api/pos/${provider}/${rid}`, { method: 'POST', headers, body });
  return POST(req, { params: Promise.resolve({ provider, restaurantId: rid }) });
}

test('only the enabled provider is accepted; the others return 404 even with a valid signature', async () => {
  process.env.POS_PROVIDERS_ENABLED = 'petpooja';
  const pp = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 'al-s1' } });
  const rw = await createRestaurant(pool, { provider: 'restroworks', credentials: { webhook_secret: 'al-s1' } });
  const up = await createRestaurant(pool, { provider: 'urbanpiper', credentials: { webhook_secret: 'al-s1' } });

  const ok = await call('petpooja', pp, menuBody, sign(menuBody, 'al-s1'));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true, result: 'menu' });

  for (const [provider, rid] of [['restroworks', rw], ['urbanpiper', up]] as const) {
    const res = await call(provider, rid, menuBody, sign(menuBody, 'al-s1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  }
});

test('a disabled provider is rejected before the signature check, so no 401 leaks', async () => {
  process.env.POS_PROVIDERS_ENABLED = 'petpooja';
  const rw = await createRestaurant(pool, { provider: 'restroworks', credentials: { webhook_secret: 'al-s2' } });
  expect((await call('restroworks', rw, menuBody)).status).toBe(404);
});
