'use client';

import { useEffect, useState } from 'react';
import { KitchenLoadBadge } from '@/components/kds/KitchenLoadBadge';
import { StationTabs, type StationFilter } from '@/components/kds/StationTabs';
import { StationTicketCard } from '@/components/kds/StationTicketCard';
import { useKdsStream } from '@/components/kds/useKdsStream';
import type { TicketView } from '@/lib/kds/ticket-view';
import { bumpItemAction, bumpTicketAction } from '@/app/ops/[restaurantId]/kds/actions';

export interface KdsBoardProps {
  restaurantId: string;
  initialTickets: TicketView[];
  initialLoad: number;
  initialBackpressure: boolean;
}

export function KdsBoard({ restaurantId, initialTickets, initialLoad, initialBackpressure }: KdsBoardProps) {
  const { tickets, load, backpressure, apply } = useKdsStream(restaurantId, initialTickets, initialLoad, initialBackpressure);
  const [station, setStation] = useState<StationFilter>('ALL');
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Elapsed times refresh every 15 seconds, on the client only.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn: () => Promise<TicketView>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const visible = tickets.filter((t) => station === 'ALL' || t.station === station);

  return (
    <div className="space-y-4">
      <KitchenLoadBadge load={load} backpressure={backpressure} />
      <StationTabs value={station} onChange={setStation} />
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-sm">No open tickets.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((ticket) => (
            <StationTicketCard
              key={ticket.id}
              ticket={ticket}
              nowMs={nowMs}
              busy={busy}
              onBumpItem={(index) => run(() => bumpItemAction({ restaurantId, ticketId: ticket.id, itemIndex: index }))}
              onBumpTicket={() => run(() => bumpTicketAction({ restaurantId, ticketId: ticket.id }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
