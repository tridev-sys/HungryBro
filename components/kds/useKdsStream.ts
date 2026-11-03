import { useCallback, useEffect, useState } from 'react';
import type { TicketView } from '@/lib/kds/ticket-view';
import { upsertTicket } from '@/lib/kds/merge';

interface StreamMessage {
  type?: string;
  tickets?: TicketView[];
  load?: number;
  backpressure?: boolean;
  ticket?: TicketView;
}

/**
 * Live board state for one restaurant. The server snapshot seeds the state; SSE events update it.
 * Returns `apply`, which the bump actions use to show their result before the event arrives.
 */
export function useKdsStream(
  restaurantId: string,
  initial: TicketView[],
  initialLoad: number,
  initialBackpressure: boolean,
) {
  const [tickets, setTickets] = useState<TicketView[]>(initial);
  const [load, setLoad] = useState(initialLoad);
  const [backpressure, setBackpressure] = useState(initialBackpressure);

  useEffect(() => {
    const source = new EventSource(`/api/ops/${restaurantId}/kds/stream`);
    source.onmessage = (msg: MessageEvent<string>) => {
      const e = JSON.parse(msg.data) as StreamMessage;
      if (e.type === 'snapshot' && e.tickets) {
        setTickets(e.tickets.filter((t) => t.status !== 'served'));
        if (e.load !== undefined) setLoad(e.load);
        if (e.backpressure !== undefined) setBackpressure(e.backpressure);
        return;
      }
      if (e.type === 'load') {
        if (e.load !== undefined) setLoad(e.load);
        if (e.backpressure !== undefined) setBackpressure(e.backpressure);
        return;
      }
      if (e.ticket) {
        const ticket = e.ticket;
        setTickets((prev) => upsertTicket(prev, ticket));
      }
    };
    return () => source.close();
  }, [restaurantId]);

  const apply = useCallback((ticket: TicketView) => {
    setTickets((prev) => upsertTicket(prev, ticket));
  }, []);

  return { tickets, load, backpressure, apply };
}
