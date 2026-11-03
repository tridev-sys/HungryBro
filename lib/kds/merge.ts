import type { TicketView } from './ticket-view';

/** Pure: replaces a ticket by id (or appends it), drops served tickets, sorts by fired time. */
export function upsertTicket(list: TicketView[], ticket: TicketView): TicketView[] {
  const rest = list.filter((t) => t.id !== ticket.id);
  const next = ticket.status === 'served' ? rest : [...rest, ticket];
  return next.sort((a, b) => Date.parse(a.firedAt) - Date.parse(b.firedAt));
}
