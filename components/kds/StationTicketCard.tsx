import type { TicketView } from '@/lib/kds/ticket-view';
import { isOverdue, slaColor } from '@/lib/kds/timers';
import { stationLabel } from '@/lib/kds/labels';
import { TicketCard } from '@/components/kds/TicketCard';

export interface StationTicketCardProps {
  ticket: TicketView;
  /** Null before the first client tick, so server and client markup match. */
  nowMs: number | null;
  onBumpItem: (index: number) => void;
  onBumpTicket: () => void;
  busy?: boolean;
}

export function StationTicketCard({ ticket, nowMs, onBumpItem, onBumpTicket, busy = false }: StationTicketCardProps) {
  const elapsed = nowMs === null ? 0 : (nowMs - Date.parse(ticket.firedAt)) / 60_000;
  const overdue = nowMs !== null && isOverdue(elapsed, ticket.orderModality);
  const origin = ticket.orderModality === 'DINE_IN'
    ? `DINE-IN: Table ${ticket.tableNumber ?? '?'}`
    : 'DELIVERY: Mesh';
  const items = ticket.items.map((i) => {
    const jain = i.dietaryFlags.includes('jain') ? ' · JAIN SPEC' : '';
    const notes = i.preparationNotes ? ` — ${i.preparationNotes}` : '';
    const bumped = i.bumped ? ' ✓' : '';
    return `${i.quantity}x ${i.name}${jain}${notes}${bumped}`;
  });

  const actions = (
    <>
      {overdue ? (
        <span className="rounded-[var(--radius-pill)] bg-[var(--color-sla-red)] px-2 py-1 text-xs font-semibold text-white">OVERDUE</span>
      ) : null}
      {ticket.items.map((item, index) => (
        <button
          key={`${ticket.id}-${item.lineId}-${index}`}
          type="button"
          disabled={busy || item.bumped || ticket.status === 'served'}
          onClick={() => onBumpItem(index)}
          className="min-h-[44px] rounded-[var(--radius-pill)] border border-[var(--color-text-muted)] px-3 text-xs font-semibold disabled:opacity-40"
        >
          Bump Item
        </button>
      ))}
      <button
        type="button"
        disabled={busy || ticket.status === 'served'}
        onClick={onBumpTicket}
        className="min-h-[44px] rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-accent-ink)] disabled:opacity-40"
      >
        Bump Ticket
      </button>
    </>
  );

  return (
    <TicketCard
      ticketNumber={ticket.ticketNumber}
      station={stationLabel(ticket.station)}
      status={ticket.status}
      elapsedMinutes={elapsed}
      orderOrigin={ticket.orderModality}
      tableLabel={origin}
      items={items}
      colour={nowMs === null ? undefined : slaColor(elapsed, ticket.orderModality)}
      actions={actions}
    />
  );
}
