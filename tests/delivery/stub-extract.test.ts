import { extractIntentStub } from '@/lib/delivery/stub-extract';

test('extracts budget, SLA, headcount, items, and locality from the sample sentence', () => {
  const r = extractIntentStub('Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar');
  expect(r).toMatchObject({
    budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3, locality: 'Indiranagar',
    items_requested: [{ query: 'biryani', serving_target: 1 }, { query: 'kebab', serving_target: 1 }],
  });
  expect(Math.abs(r.client_coordinates!.lat - 12.9719)).toBeLessThan(0.001);
});

test('an unknown locality leaves coordinates undefined', () => {
  expect(extractIntentStub('Biryani under 500 in 25 min to Whitefield').client_coordinates).toBeUndefined();
});
