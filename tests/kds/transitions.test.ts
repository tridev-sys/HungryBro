import { nextStatusAfterBump, nextStatusAfterTicketBump } from '@/lib/kds/transitions';

test('bumping one item of a queued ticket starts it; bumping the last item readies it', () => {
  expect(nextStatusAfterBump('queued', false)).toBe('in_prep');
  expect(nextStatusAfterBump('in_prep', false)).toBe('in_prep');
  expect(nextStatusAfterBump('in_prep', true)).toBe('ready');
  expect(nextStatusAfterBump('queued', true)).toBe('ready');
});

test('an item cannot be bumped on a ready, served, or voided ticket', () => {
  expect(() => nextStatusAfterBump('ready', false)).toThrow('INVALID_TRANSITION');
  expect(() => nextStatusAfterBump('served', true)).toThrow('INVALID_TRANSITION');
  expect(() => nextStatusAfterBump('voided', false)).toThrow('INVALID_TRANSITION');
});

test('bumping a ticket serves it from any open state; served cannot be bumped again (Review Focus 5)', () => {
  expect(nextStatusAfterTicketBump('queued')).toBe('served');
  expect(nextStatusAfterTicketBump('in_prep')).toBe('served');
  expect(nextStatusAfterTicketBump('ready')).toBe('served');
  expect(nextStatusAfterTicketBump('voided')).toBe('served');
  expect(() => nextStatusAfterTicketBump('served')).toThrow('INVALID_TRANSITION');
});
