import { round2 } from '@/lib/pricing';

// Business ledger calculations (pure, no I/O). Owner decisions, 2026-11-04.

/** Restaurant SaaS fee per physical outlet per month, INR. */
export const OUTLET_SAAS_FEE_INR = 499;

/**
 * Baseline 3PL dispatch cost, INR. Config default only: the real cost for each order comes from
 * the dispatch adapter and is never read from this constant.
 */
export const DISPATCH_BASELINE_COST_INR = 50;

function assertCount(n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`outlet count must be a non-negative integer, got ${n}`);
  }
}

function assertAmount(label: string, n: number): void {
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`${label} must be a non-negative finite amount, got ${n}`);
  }
}

/** Monthly SaaS charge for a count of physical outlets, rounded half-up to paise. */
export function monthlySaasCharge(outlets: number, feePerOutletInr: number = OUTLET_SAAS_FEE_INR): number {
  assertCount(outlets);
  assertAmount('fee per outlet', feePerOutletInr);
  return round2(outlets * feePerOutletInr);
}

export interface PassThroughTotal {
  orderTotalInr: number;
  passThroughCostInr: number;
  totalInr: number;
}

/** Adds the 3PL dispatch cost to the order total at cost (no markup). */
export function withPassThrough(orderTotalInr: number, dispatchCostInr: number): PassThroughTotal {
  assertAmount('order total', orderTotalInr);
  assertAmount('dispatch cost', dispatchCostInr);
  return {
    orderTotalInr,
    passThroughCostInr: round2(dispatchCostInr),
    totalInr: round2(orderTotalInr + dispatchCostInr),
  };
}
