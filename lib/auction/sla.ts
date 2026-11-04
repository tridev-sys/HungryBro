// 30 minute delivery SLA as an operational eligibility constraint (owner decision, 2026-11-04):
// a kitchen is eligible only when prep + transit + buffer <= max SLA. Pure, no I/O.

/** Owner: "under 30 minutes". Configurable constant. */
export const MAX_SLA_MINUTES = 30;
/** Engineering default safety buffer (recorded in tech-decisions). */
export const SLA_BUFFER_MINUTES = 3;
/**
 * Pre-dispatch transit estimate. There is no stored transit time before dispatch, so this reuses
 * the existing estimate: the sandbox dispatch ETA (lib/dispatch/sandbox.ts, 12 minutes).
 */
export const TRANSIT_ESTIMATE_MINUTES = 12;

export interface SlaOptions {
  maxSlaMinutes: number;
  bufferMinutes: number;
}

const DEFAULT_OPTIONS: SlaOptions = { maxSlaMinutes: MAX_SLA_MINUTES, bufferMinutes: SLA_BUFFER_MINUTES };

/** Largest prep time (minutes) that still meets the SLA for the given transit time. */
export function maxPrepMinutes(
  transitMinutes: number = TRANSIT_ESTIMATE_MINUTES,
  opts: SlaOptions = DEFAULT_OPTIONS,
): number {
  return opts.maxSlaMinutes - transitMinutes - opts.bufferMinutes;
}

/** True when prep + transit + buffer is within the SLA (boundary inclusive). */
export function withinSla(
  prepMinutes: number,
  transitMinutes: number = TRANSIT_ESTIMATE_MINUTES,
  opts: SlaOptions = DEFAULT_OPTIONS,
): boolean {
  return prepMinutes + transitMinutes + opts.bufferMinutes <= opts.maxSlaMinutes;
}
