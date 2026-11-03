import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { restroworksAdapter } from '@/lib/pos/restroworks';
import { getPosAdapter } from '@/lib/pos/registry';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('restroworks-menu.json'));

test('flattens variations into pos_item_code productId::variationId', () => {
  const rows = restroworksAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['rw-dal-10::half', 'rw-dal-10::full', 'rw-kebab-11::std']);
});

test('maps names, prices, station, and stock per variation, without dietary', () => {
  const rows = restroworksAdapter.mapMenu(menu);
  expect(rows[0]).toMatchObject({ name: 'Dal Tadka', base_price: 140, station: 'Curry', is_in_stock: true });
  expect(rows[2]).toMatchObject({ base_price: 360, is_in_stock: false });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('parses a variation stock webhook into a stock event for the composite code', () => {
  expect(restroworksAdapter.parseWebhook(fixture('restroworks-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'rw-dal-10::half', is_in_stock: false });
});

test('verifies an ASSUMED base64 HMAC header', () => {
  const raw = fixture('restroworks-stock-webhook.json');
  const sig = createHmac('sha256', 'rw-secret').update(raw).digest('base64');
  expect(restroworksAdapter.verifySignature({ rawBody: raw, headers: { 'x-restroworks-signature': sig }, secret: 'rw-secret' })).toBe(true);
  expect(restroworksAdapter.verifySignature({ rawBody: raw, headers: { 'x-restroworks-signature': sig }, secret: 'wrong' })).toBe(false);
});

test('registry resolves restroworks', () => {
  expect(getPosAdapter('restroworks')).toBe(restroworksAdapter);
});
