import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseOnSearch, parseOnSelect, BecknParseError } from '@/lib/ondc/beckn';

const load = (f: string) => JSON.parse(readFileSync(path.join(__dirname, '../fixtures/ondc', f), 'utf8'));
const search = load('on-search.json');
const select = load('on-select.json');

test('parseOnSearch returns providers with items priced in INR', () => {
  const [p] = parseOnSearch(search);
  expect(p).toMatchObject({ source: 'ondc', bppId: 'bpp.test.invalid', providerId: 'prov-blr-1', providerName: 'Nagarjuna Koramangala' });
  expect(p.items).toEqual([
    { externalId: 'item-biryani', name: 'Chicken Biryani', priceInr: 349, available: true },
    { externalId: 'item-raita', name: 'Raita', priceInr: 60.5, available: false },
  ]);
});

test('parseOnSelect returns the bundle quote in the internal shape', () => {
  expect(parseOnSelect(select)).toEqual({
    source: 'ondc', bppId: 'bpp.test.invalid', providerId: 'prov-blr-1',
    totalPriceInr: 698, currency: 'INR', fulfillmentId: 'ful-1', etaMinutes: 28,
  });
});

test('rejects an envelope whose action does not match the parser', () => {
  expect(() => parseOnSelect(search)).toThrow(BecknParseError);
  expect(() => parseOnSearch(select)).toThrow(BecknParseError);
});

test('rejects non-INR currency and non-positive prices', () => {
  const usd = structuredClone(select);
  usd.message.order.quote.price.currency = 'USD';
  expect(() => parseOnSelect(usd)).toThrow(BecknParseError);
  const zero = structuredClone(search);
  zero.message.catalog['bpp/providers'][0].items[0].price.value = '0';
  expect(() => parseOnSearch(zero)).toThrow(BecknParseError);
});

test('rejects a malformed envelope', () => {
  expect(() => parseOnSearch({})).toThrow(BecknParseError);
});
