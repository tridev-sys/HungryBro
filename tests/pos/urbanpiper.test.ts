import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { urbanpiperAdapter } from '@/lib/pos/urbanpiper';
import { getPosAdapter } from '@/lib/pos/registry';
import { PosPayloadError } from '@/lib/pos/types';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('urbanpiper-menu.json'));

test('maps items keyed by retailer_id', () => {
  const rows = urbanpiperAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['up-idli-20', 'up-mutton-21']);
  expect(rows[0]).toMatchObject({ name: 'Idli Sambar (2)', base_price: 90, station: 'Pantry', category_name: 'South Indian' });
  expect(rows[1]).toMatchObject({ base_price: 420, is_in_stock: true });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('parses an availability event', () => {
  expect(urbanpiperAdapter.parseWebhook(fixture('urbanpiper-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'up-idli-20', is_in_stock: false });
});

test('rejects a payload for a different location than the configured one', () => {
  const other = JSON.parse(fixture('urbanpiper-stock-webhook.json'));
  other.location_id = 'UP-LOC-99';
  expect(() => urbanpiperAdapter.parseWebhook(JSON.stringify(other), { expectedLocationId: 'UP-LOC-77' }))
    .toThrow(PosPayloadError);
});

test('verifies an ASSUMED hex HMAC header', () => {
  const raw = fixture('urbanpiper-stock-webhook.json');
  const sig = createHmac('sha256', 'up-secret').update(raw).digest('hex');
  expect(urbanpiperAdapter.verifySignature({ rawBody: raw, headers: { 'x-urbanpiper-signature': sig }, secret: 'up-secret' })).toBe(true);
});

test('registry resolves urbanpiper', () => {
  expect(getPosAdapter('urbanpiper')).toBe(urbanpiperAdapter);
});
