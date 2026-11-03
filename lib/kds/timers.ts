// Decision 3, one rule: green under 5 min; yellow from 5 min up to the SLA; red at or past the SLA.
export type OrderModality = 'DINE_IN' | 'DELIVERY';
export type SlaColor = 'green' | 'yellow' | 'red';

const GREEN_UNDER_MINUTES = 5;

export function slaMinutes(m: OrderModality): 8 | 12 {
  return m === 'DINE_IN' ? 8 : 12;
}

export function slaColor(elapsedMinutes: number, m: OrderModality): SlaColor {
  const sla = slaMinutes(m);
  if (elapsedMinutes >= sla) return 'red';
  if (elapsedMinutes >= GREEN_UNDER_MINUTES) return 'yellow';
  return 'green';
}

export function isOverdue(elapsedMinutes: number, m: OrderModality): boolean {
  return elapsedMinutes >= slaMinutes(m);
}
