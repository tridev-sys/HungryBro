import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { petpoojaAdapter } from '@/lib/pos/petpooja';
import { getPosAdapter } from '@/lib/pos/registry';
import { PosPayloadError } from '@/lib/pos/types';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('petpooja-menu.json'));

test('maps every fixture item to a menu_items row keyed by pos_item_code', () => {
  const rows = petpoojaAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['pp-naan-01', 'pp-garlic-02', 'pp-paneer-03', 'pp-chicken-04']);
  expect(rows[0]).toMatchObject({
    name: 'Butter Naan', base_price: 60, is_in_stock: true,
    category_name: 'Breads', station: 'Tandoor',
  });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('maps out-of-stock flags and never maps a veg flag to dietary (Decision 7)', () => {
  const rows = petpoojaAdapter.mapMenu(menu);
  expect(rows[1].is_in_stock).toBe(false);
  expect(rows[3]).toMatchObject({ name: 'Chicken Curry', base_price: 320 });
  expect(rows[3]).not.toHaveProperty('dietary');
});

test('verifies an ASSUMED hex HMAC over the raw body', () => {
  const raw = fixture('petpooja-stock-webhook.json');
  const sig = createHmac('sha256', 'pp-secret').update(raw).digest('hex');
  expect(petpoojaAdapter.verifySignature({ rawBody: raw, headers: { 'x-petpooja-signature': sig }, secret: 'pp-secret' })).toBe(true);
  expect(petpoojaAdapter.verifySignature({ rawBody: raw, headers: {}, secret: 'pp-secret' })).toBe(false);
});

test('parses the stock webhook into a stock event', () => {
  expect(petpoojaAdapter.parseWebhook(fixture('petpooja-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'pp-naan-01', is_in_stock: false });
});

test('rejects a menu with a non-positive price', () => {
  const bad = structuredClone(menu);
  bad.categories[0].items[0].price = '0.00';
  expect(() => petpoojaAdapter.mapMenu(bad)).toThrow(PosPayloadError);
});

test('registry resolves known providers only', () => {
  expect(getPosAdapter('petpooja')?.provider).toBe('petpooja');
  expect(getPosAdapter('unknown')).toBeUndefined();
});
