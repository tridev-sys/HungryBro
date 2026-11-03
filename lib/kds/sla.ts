export type SlaColour = 'green' | 'yellow' | 'red';
export type OrderOrigin = 'DINE_IN' | 'DELIVERY';

const GREEN_UNDER_MINUTES = 5;

/** Decision 3: green under 5 min, yellow from 5 min through the SLA, red after the SLA. */
export function slaState(elapsedMinutes: number, slaMinutes: number): SlaColour {
  if (elapsedMinutes < GREEN_UNDER_MINUTES) return 'green';
  if (elapsedMinutes <= slaMinutes) return 'yellow';
  return 'red';
}

export function slaMinutesFor(order: OrderOrigin): number {
  return order === 'DINE_IN' ? 8 : 12;
}
