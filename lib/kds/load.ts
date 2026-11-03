import { round2 } from '@/lib/pricing';

export const KDS_SLOT_CAPACITY = 25;
export const BACKPRESSURE_THRESHOLD = 0.85;

/** active_kds_load: open tickets over slot capacity, capped at 1.00, two decimals. */
export function kdsLoad(openTickets: number, capacity: number = KDS_SLOT_CAPACITY): number {
  return Math.min(1, round2(openTickets / capacity));
}

export function backpressureWarning(load: number): boolean {
  return load > BACKPRESSURE_THRESHOLD;
}
