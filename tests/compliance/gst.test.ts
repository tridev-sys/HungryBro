import { invoiceGstBreakdown } from '@/lib/compliance/gst';

test('invoice breakdown is 5% GST split evenly into CGST and SGST', () => {
  expect(invoiceGstBreakdown(700)).toEqual({ subtotal: 700, gst: 35, cgst: 17.5, sgst: 17.5 });
});

test('odd paise round half-up and CGST plus SGST equals GST', () => {
  const b = invoiceGstBreakdown(333.33);
  expect(round(b.cgst + b.sgst)).toBe(b.gst);
});

function round(n: number) { return Math.round(n * 100) / 100; }
