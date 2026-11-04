import { createSubscriber, getRedis } from '@/lib/redis';
import type { TicketView } from './ticket-view';

export interface TicketKdsEvent {
  type: 'ticket.fired' | 'ticket.updated';
  restaurantId: string;
  sessionId: string | null;
  ticket: TicketView;
}

/** A table session closed after its payment shares all settled. Published once, after commit. */
export interface SessionSettledEvent {
  type: 'session.settled';
  restaurantId: string;
  sessionId: string;
}

export type KdsEvent = TicketKdsEvent | SessionSettledEvent;

export function kdsChannel(restaurantId: string): string {
  return `kds:restaurant:${restaurantId}`;
}

/** Call only after the database transaction has committed. */
export async function publishKdsEvent(e: KdsEvent): Promise<void> {
  await getRedis().publish(kdsChannel(e.restaurantId), JSON.stringify(e));
}

/** Resolves once the subscription is active. The returned function closes the connection. */
export async function subscribeKdsEvents(
  restaurantId: string,
  onEvent: (e: KdsEvent) => void,
): Promise<() => Promise<void>> {
  const sub = createSubscriber();
  const channel = kdsChannel(restaurantId);
  sub.on('message', (ch: string, message: string) => {
    if (ch !== channel) return;
    onEvent(JSON.parse(message) as KdsEvent);
  });
  await sub.subscribe(channel);
  return async () => {
    await sub.quit();
  };
}
