import { computeSettlement } from '@/lib/settlement/split';

const line = (unitPrice: number, quantity: number, participantIndex: number | null = null) =>
  ({ unitPrice, quantity, participantIndex });

test('EQUAL: subtotal 840 with 5% GST is 882, split four ways at 220.50 (PDF wireframe)', () => {
  const s = computeSettlement({ lines: [line(840, 1)], strategy: 'EQUAL', contributorCount: 4 });
  expect(s.subtotal).toBe(840);
  expect(s.gst).toBe(42);
  expect(s.cgst).toBe(21);
  expect(s.sgst).toBe(21);
  expect(s.total).toBe(882);
  expect(s.shares.map((x) => x.amount)).toEqual([220.5, 220.5, 220.5, 220.5]);
});

test('EQUAL: the extra paisa goes to the first shares (Review Focus 3)', () => {
  const s = computeSettlement({ lines: [line(10.01, 1)], strategy: 'EQUAL', contributorCount: 3 });
  expect(s.total).toBe(10.51);
  expect(s.shares.map((x) => x.amount)).toEqual([3.51, 3.5, 3.5]);
});

test('BY_CONSUMPTION: assigned lines follow their diner, shared lines split equally (Review Focus 3)', () => {
  const s = computeSettlement({
    lines: [line(400, 1, 0), line(60, 1, null), line(80, 1, 1)],
    strategy: 'BY_CONSUMPTION',
    contributorCount: 2,
  });
  expect(s.total).toBe(567);
  expect(s.shares.map((x) => x.base)).toEqual([430, 110]);
  expect(s.shares.map((x) => x.gst)).toEqual([21.5, 5.5]);
  expect(s.shares.map((x) => x.amount)).toEqual([451.5, 115.5]);
});

test('a line assigned to a non-existent diner is rejected (Review Focus 3)', () => {
  expect(() => computeSettlement({ lines: [line(100, 1, 2)], strategy: 'BY_CONSUMPTION', contributorCount: 2 }))
    .toThrow(RangeError);
});

test('shares sum to the total in paise for every party size (Review Focus 3)', () => {
  for (let n = 1; n <= 6; n++) {
    const s = computeSettlement({ lines: [line(333.33, 1), line(47.5, 3)], strategy: 'EQUAL', contributorCount: n });
    const paise = s.shares.reduce((acc, x) => acc + Math.round(x.amount * 100), 0);
    expect(paise).toBe(Math.round(s.total * 100));
  }
});
