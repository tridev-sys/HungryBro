export const MESH_PROTOCOL_FEE_RATE = 0.035;
export const STATUTORY_GST_RATE = 0.05;
export const DEFAULT_FLOOR_MARGIN = 0.05;

export function round2(n: number): number {
  return Math.round(n * 100 + Number.EPSILON) / 100;
}

export interface PriceLine {
  basePrice: number;
  quantity: number;
}

export interface BundleQuote {
  baseSubtotal: number;
  meshFee: number;
  kitchenNet: number;
  passesFloor: boolean;
}

export function quoteBundle(
  lines: PriceLine[],
  offeredPriceInr: number,
  floorMargin: number = DEFAULT_FLOOR_MARGIN,
): BundleQuote {
  if (offeredPriceInr <= 0) {
    throw new RangeError(`offeredPriceInr must be positive, got ${offeredPriceInr}`);
  }
  const baseSubtotal = round2(lines.reduce((sum, l) => sum + l.basePrice * l.quantity, 0));
  const meshFee = round2(offeredPriceInr * MESH_PROTOCOL_FEE_RATE);
  const kitchenNet = round2(offeredPriceInr - meshFee);
  const passesFloor = kitchenNet >= round2(baseSubtotal * (1 - floorMargin));
  return { baseSubtotal, meshFee, kitchenNet, passesFloor };
}

export function gstOn(subtotal: number, rate: number = STATUTORY_GST_RATE): number {
  return round2(subtotal * rate);
}

export function splitGst(gst: number): { cgst: number; sgst: number } {
  // SGST takes the remainder so the two halves always sum to the GST amount (odd paise).
  const cgst = round2(gst / 2);
  return { cgst, sgst: round2(gst - cgst) };
}
