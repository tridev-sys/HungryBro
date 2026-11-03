import { upsertTicket } from '@/lib/kds/merge';
import type { TicketView } from '@/lib/kds/ticket-view';

const t = (id: string, firedAt: string, status: TicketView['status'] = 'queued') =>
  ({ id, firedAt, status }) as TicketView;

test('a new ticket is appended in fired order', () => {
  const out = upsertTicket([t('a', '2026-11-03T10:00:00Z')], t('b', '2026-11-03T09:59:00Z'));
  expect(out.map((x) => x.id)).toEqual(['b', 'a']);
});

test('an update replaces the ticket with the same id', () => {
  const out = upsertTicket([t('a', '2026-11-03T10:00:00Z')], t('a', '2026-11-03T10:00:00Z', 'in_prep'));
  expect(out).toHaveLength(1);
  expect(out[0].status).toBe('in_prep');
});

test('a served ticket leaves the board', () => {
  const out = upsertTicket([t('a', '2026-11-03T10:00:00Z')], t('a', '2026-11-03T10:00:00Z', 'served'));
  expect(out).toEqual([]);
});
