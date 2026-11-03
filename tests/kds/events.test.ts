import { publishKdsEvent, subscribeKdsEvents, kdsChannel } from '@/lib/kds/events';

test('a published event reaches a subscriber on the restaurant channel', async () => {
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  expect(kdsChannel(restaurantId)).toBe(`kds:restaurant:${restaurantId}`);
  const received = new Promise<unknown>((resolve) => {
    subscribeKdsEvents(restaurantId, resolve).then(async (stop) => {
      await publishKdsEvent({ type: 'ticket.fired', restaurantId, sessionId: null,
        ticket: { id: 'x', station: 'Bar' } as never });
      setTimeout(() => stop(), 0);
    });
  });
  const event = await received as { type: string };
  expect(event.type).toBe('ticket.fired');
});
