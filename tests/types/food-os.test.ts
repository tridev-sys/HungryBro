import { DeliveryIntentSchema, CartUpdateSchema } from '@/types/food-os';

const base = {
  modality: 'DELIVERY',
  budget_ceiling_inr: 800,
  sla_max_minutes: 30,
  headcount: 3,
  target_dietary_profiles: ['jain'],
  items_requested: [{ query: 'biryani', serving_target: 2 }],
  client_coordinates: { lat: 12.9716, lng: 77.6412 },
};

test('accepts a valid delivery intent', () => {
  expect(DeliveryIntentSchema.safeParse(base).success).toBe(true);
});

test('rejects SLA below 15 and above 120 minutes', () => {
  expect(DeliveryIntentSchema.safeParse({ ...base, sla_max_minutes: 14 }).success).toBe(false);
  expect(DeliveryIntentSchema.safeParse({ ...base, sla_max_minutes: 121 }).success).toBe(false);
});

test('rejects out-of-range coordinates (Review Focus 1)', () => {
  expect(DeliveryIntentSchema.safeParse({ ...base, client_coordinates: { lat: 250, lng: 77.6 } }).success).toBe(false);
  expect(DeliveryIntentSchema.safeParse({ ...base, client_coordinates: { lat: 12.9, lng: 181 } }).success).toBe(false);
});

test('rejects zero or negative budget', () => {
  expect(DeliveryIntentSchema.safeParse({ ...base, budget_ceiling_inr: 0 }).success).toBe(false);
  expect(DeliveryIntentSchema.safeParse({ ...base, budget_ceiling_inr: -5 }).success).toBe(false);
});

test('CartUpdate defaults station to General and dietary_flags to []', () => {
  const r = CartUpdateSchema.parse({
    order_type: 'DINE_IN',
    action: 'ADD',
    items: [{ item_id: 'x', name: 'Naan', quantity: 2 }],
  });
  expect(r.items[0].station).toBe('General');
  expect(r.items[0].dietary_flags).toEqual([]);
});

test('CartUpdate rejects quantity 0 and notes over 100 chars', () => {
  const mk = (over: object) => ({ order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: 'x', name: 'Naan', ...over }] });
  expect(CartUpdateSchema.safeParse(mk({ quantity: 0 })).success).toBe(false);
  expect(CartUpdateSchema.safeParse(mk({ quantity: 1, preparation_notes: 'x'.repeat(101) })).success).toBe(false);
});
