import type { StationCategory, TicketStatus } from '@/types/food-os';
import type { TicketView } from './ticket-view';

const STATION_LABEL: Record<StationCategory, string> = {
  Tandoor: 'Tandoor & Breads',
  Curry: 'Curry',
  Pantry: 'Pantry',
  Bar: 'Bar',
  General: 'General',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  queued: 'QUEUED',
  in_prep: 'PREPARING',
  ready: 'READY',
  served: 'SERVED',
  voided: 'VOID',
};

export function stationLabel(s: StationCategory): string {
  return STATION_LABEL[s];
}

export function statusLabel(s: TicketStatus): string {
  return STATUS_LABEL[s];
}

/** Feed format: `Ticket #NN - <station>: <qty>x <name>[ (Jain)], ... [<STATUS> <elapsed>m]`. */
export function ticketLabel(t: TicketView, nowMs: number): string {
  const number = String(t.ticketNumber).padStart(2, '0');
  const items = t.items
    .map((i) => `${i.quantity}x ${i.name}${i.dietaryFlags.includes('jain') ? ' (Jain)' : ''}`)
    .join(', ');
  const elapsed = Math.floor((nowMs - Date.parse(t.firedAt)) / 60_000);
  return `Ticket #${number} - ${stationLabel(t.station)}: ${items} [${statusLabel(t.status)} ${elapsed}m]`;
}
