import { canTransition, allowsCartChanges } from '@/lib/dine/session-state';

const none = { anyShareSettled: false };

test('active to payment_pending and payment_pending to closed are allowed', () => {
  expect(canTransition('active', 'payment_pending', none)).toBe(true);
  expect(canTransition('payment_pending', 'closed', none)).toBe(true);
});

test('payment_pending to active is allowed only before any share is settled (Review Focus 4)', () => {
  expect(canTransition('payment_pending', 'active', { anyShareSettled: false })).toBe(true);
  expect(canTransition('payment_pending', 'active', { anyShareSettled: true })).toBe(false);
});

test('every other transition is rejected (Review Focus 4)', () => {
  expect(canTransition('active', 'closed', none)).toBe(false);
  expect(canTransition('closed', 'active', none)).toBe(false);
  expect(canTransition('closed', 'payment_pending', none)).toBe(false);
  expect(canTransition('active', 'active', none)).toBe(false);
  expect(canTransition('active', 'abandoned', none)).toBe(false);
  expect(canTransition('payment_pending', 'abandoned', none)).toBe(false);
});

test('cart changes are accepted only while active (Review Focus 4)', () => {
  expect(allowsCartChanges('active')).toBe(true);
  expect(allowsCartChanges('payment_pending')).toBe(false);
  expect(allowsCartChanges('closed')).toBe(false);
  expect(allowsCartChanges('abandoned')).toBe(false);
});
