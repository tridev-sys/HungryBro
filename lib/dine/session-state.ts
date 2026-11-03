import type { SessionStatus } from '@/types/food-os';

/** The only legal session moves. Anything else is rejected. */
export function canTransition(
  from: SessionStatus,
  to: SessionStatus,
  ctx: { anyShareSettled: boolean },
): boolean {
  switch (from) {
    case 'active':
      return to === 'payment_pending';
    case 'payment_pending':
      if (to === 'closed') return true;
      if (to === 'active') return !ctx.anyShareSettled;
      return false;
    default:
      return false;
  }
}

export function allowsCartChanges(status: SessionStatus): boolean {
  return status === 'active';
}
