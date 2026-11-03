import type { TicketStatus } from '@/types/food-os';

/** Bumping one item: queued or in_prep moves to in_prep, or to ready when every item is bumped. */
export function nextStatusAfterBump(current: TicketStatus, allItemsBumped: boolean): TicketStatus {
  if (current === 'queued' || current === 'in_prep') {
    return allItemsBumped ? 'ready' : 'in_prep';
  }
  throw new Error('INVALID_TRANSITION');
}

/** Bumping the whole ticket serves it from any open state, including voided. Served is final. */
export function nextStatusAfterTicketBump(current: TicketStatus): TicketStatus {
  if (current === 'served') throw new Error('INVALID_TRANSITION');
  return 'served';
}
