import { round2, quoteBundle, gstOn, splitGst } from '@/lib/pricing';

test('round2 rounds half-up', () => {
  expect(round2(2.345)).toBe(2.35);
  expect(round2(1.1)).toBe(1.1);
});

test('quoteBundle computes subtotal, mesh fee, and net for a passing bundle', () => {
  const q = quoteBundle([{ basePrice: 350, quantity: 2 }], 710);
  expect(q.baseSubtotal).toBe(700);
  expect(q.meshFee).toBe(24.85);
  expect(q.kitchenNet).toBe(685.15);
  expect(q.passesFloor).toBe(true);
});

test('quoteBundle fails the floor when the offer is far below list', () => {
  expect(quoteBundle([{ basePrice: 1000, quantity: 1 }], 500).passesFloor).toBe(false);
});

test('quoteBundle rejects zero or negative offers (Review Focus 5)', () => {
  expect(() => quoteBundle([{ basePrice: 100, quantity: 1 }], 0)).toThrow(RangeError);
  expect(() => quoteBundle([{ basePrice: 100, quantity: 1 }], -10)).toThrow(RangeError);
});

test('gstOn applies 5%; splitGst halves it into CGST and SGST', () => {
  expect(gstOn(700)).toBe(35);
  expect(splitGst(35)).toEqual({ cgst: 17.5, sgst: 17.5 });
});

test('splitGst halves preserve the total for odd paise (CGST + SGST equals GST)', () => {
  const s = splitGst(16.67);
  expect(round2(s.cgst + s.sgst)).toBe(16.67);
});
