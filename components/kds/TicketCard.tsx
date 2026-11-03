import { slaMinutesFor, slaState, type OrderOrigin } from '@/lib/kds/sla';

export type TicketStatus = 'queued' | 'in_prep' | 'ready' | 'served' | 'voided';

export interface TicketCardProps {
  ticketNumber: number;
  station: string;
  status: TicketStatus;
  elapsedMinutes: number;
  orderOrigin: OrderOrigin;
  tableLabel?: string;
  items: string[];
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  queued: 'Queued',
  in_prep: 'In prep',
  ready: 'Ready',
  served: 'Served',
  voided: 'Voided',
};

const DOT_CLASS = {
  green: 'bg-[var(--color-sla-green)]',
  yellow: 'bg-[var(--color-sla-yellow)]',
  red: 'bg-[var(--color-sla-red)]',
} as const;

export function TicketCard({
  ticketNumber,
  station,
  status,
  elapsedMinutes,
  orderOrigin,
  tableLabel,
  items,
}: TicketCardProps) {
  const colour = slaState(elapsedMinutes, slaMinutesFor(orderOrigin));

  return (
    <article className="min-w-[160px] snap-start rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tabular-nums">Ticket #{String(ticketNumber).padStart(2, '0')}</h3>
        <span aria-hidden="true" className={`h-3 w-3 rounded-full ${DOT_CLASS[colour]}`} />
      </header>
      <p className="mt-1 text-xs font-semibold tracking-wide text-[var(--color-text-muted)]">{station}</p>
      {tableLabel ? <p className="text-xs text-[var(--color-text-muted)]">{tableLabel}</p> : null}
      <p className="mt-2 text-xs text-[var(--color-text)]">
        {STATUS_LABEL[status]} · {Math.floor(elapsedMinutes)}m elapsed
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
