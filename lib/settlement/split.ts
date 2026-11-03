import { gstOn, round2, splitGst } from '@/lib/pricing';

// All share arithmetic runs in integer paise; values convert to rupees only at the output.

export interface SettlementLine {
  unitPrice: number;
  quantity: number;
  participantIndex: number | null;
}

export interface ShareAmount {
  index: number;
  amount: number;
  base?: number;
  gst?: number;
}

export interface Settlement {
  subtotal: number;
  gst: number;
  cgst: number;
  sgst: number;
  total: number;
  shares: ShareAmount[];
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** Splits `totalCents` into `n` parts; the first `totalCents mod n` parts get one extra paisa. */
function equalCents(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const extra = totalCents % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export function computeSettlement(input: {
  lines: SettlementLine[];
  strategy: 'EQUAL' | 'BY_CONSUMPTION';
  contributorCount: number;
}): Settlement {
  const { lines, strategy, contributorCount: n } = input;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`contributorCount must be a whole number >= 1, got ${n}`);
  for (const l of lines) {
    if (!(l.quantity > 0) || !(l.unitPrice > 0)) {
      throw new RangeError('every line needs a positive quantity and unit price');
    }
  }

  const subtotalPaise = lines.reduce((acc, l) => acc + toPaise(l.unitPrice) * l.quantity, 0);
  const subtotal = round2(subtotalPaise / 100);
  const gst = gstOn(subtotal);
  const { cgst, sgst } = splitGst(gst);
  const total = round2(subtotal + gst);
  const totalCents = toPaise(total);

  if (strategy === 'EQUAL') {
    const shares = equalCents(totalCents, n).map((cents, index) => ({ index, amount: cents / 100 }));
    return { subtotal, gst, cgst, sgst, total, shares };
  }

  const assigned: number[] = Array.from({ length: n }, () => 0);
  let sharedPaise = 0;
  for (const l of lines) {
    const paise = toPaise(l.unitPrice) * l.quantity;
    if (l.participantIndex === null) {
      sharedPaise += paise;
    } else {
      if (l.participantIndex < 0 || l.participantIndex >= n) {
        throw new RangeError(`participantIndex ${l.participantIndex} is outside [0, ${n})`);
      }
      assigned[l.participantIndex] += paise;
    }
  }

  const sharedParts = equalCents(sharedPaise, n);
  const basePaise = assigned.map((p, i) => p + sharedParts[i]);
  const gstPaise = basePaise.map((b) => toPaise(gstOn(b / 100)));
  const amountPaise = basePaise.map((b, i) => b + gstPaise[i]);
  // The last share absorbs rounding so the shares sum to the total exactly.
  const othersPaise = amountPaise.slice(0, n - 1).reduce((acc, a) => acc + a, 0);
  amountPaise[n - 1] = totalCents - othersPaise;

  const shares = amountPaise.map((a, index) => ({
    index,
    amount: a / 100,
    base: basePaise[index] / 100,
    gst: gstPaise[index] / 100,
  }));
  return { subtotal, gst, cgst, sgst, total, shares };
}
