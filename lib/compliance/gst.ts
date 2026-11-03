import { gstOn, splitGst, round2 } from '@/lib/pricing';

export interface InvoiceGstBreakdown {
  subtotal: number;
  gst: number;
  cgst: number;
  sgst: number;
}

/** GST invoice breakdown using the Plan 01 helpers. No new money math here. */
export function invoiceGstBreakdown(subtotal: number): InvoiceGstBreakdown {
  const sub = round2(subtotal);
  const gst = gstOn(sub);
  const { cgst, sgst } = splitGst(gst);
  return { subtotal: sub, gst, cgst, sgst };
}
