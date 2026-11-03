import { stationLabel, ticketLabel } from '@/lib/kds/labels';
import type { TicketView } from '@/lib/kds/ticket-view';

test('Tandoor is shown as "Tandoor & Breads"', () => {
  expect(stationLabel('Tandoor')).toBe('Tandoor & Breads');
  expect(stationLabel('Bar')).toBe('Bar');
});

test('a ticket label matches the md feed format', () => {
  const now = Date.parse('2026-11-03T10:04:00Z');
  const t = {
    ticketNumber: 1, station: 'Tandoor', status: 'in_prep',
    firedAt: '2026-11-03T10:00:00Z',
    items: [{ quantity: 1, name: 'Paneer Tikka', dietaryFlags: ['jain'] }],
  } as unknown as TicketView;
  expect(ticketLabel(t, now)).toBe('Ticket #01 - Tandoor & Breads: 1x Paneer Tikka (Jain) [PREPARING 4m]');
});
