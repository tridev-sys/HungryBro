import { BapClient, NotEnabledError, type BapConfig } from '@/lib/ondc/bap-client';

const cfg: BapConfig = {
  bapId: 'bap.food.test', bapUri: 'https://bap.food.test', gatewayUrl: 'https://gateway.ondc.test',
  domain: 'ONDC:RET10', country: 'IND', city: 'std:080', coreVersion: '1.2.0', liveSend: false,
};
const common = { transactionId: 't1', messageId: 'm1', timestamp: '2026-11-03T12:00:00.000Z' };

test('buildSearch produces a Beckn search envelope with GPS as lat,lng', () => {
  const fetchSpy = vi.fn();
  const client = new BapClient(cfg, fetchSpy as unknown as typeof fetch);
  const env = client.buildSearch({ ...common, query: 'biryani', lat: 12.9352, lng: 77.6245 });
  expect(env.context).toMatchObject({ domain: 'ONDC:RET10', action: 'search', core_version: '1.2.0', bap_id: 'bap.food.test', transaction_id: 't1' });
  expect((env.message as any).intent.item.descriptor.name).toBe('biryani');
  expect((env.message as any).intent.fulfillment.end.location.gps).toBe('12.9352,77.6245');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('buildSelect carries provider, items, and bpp_id', () => {
  const env = new BapClient(cfg).buildSelect({ ...common, bppId: 'bpp.test', providerId: 'prov-1', items: [{ id: 'item-1', count: 2 }], lat: 12.93, lng: 77.62 });
  expect(env.context.bpp_id).toBe('bpp.test');
  expect((env.message as any).order.items).toEqual([{ id: 'item-1', quantity: { count: 2 } }]);
  expect((env.message as any).order.provider.id).toBe('prov-1');
});

test('send is refused and never touches the network while liveSend is false', async () => {
  const fetchSpy = vi.fn();
  const client = new BapClient(cfg, fetchSpy as unknown as typeof fetch);
  const env = client.buildSearch({ ...common, query: 'x', lat: 12.9, lng: 77.6 });
  await expect(client.send(env)).rejects.toThrow(NotEnabledError);
  expect(fetchSpy).not.toHaveBeenCalled();
});
