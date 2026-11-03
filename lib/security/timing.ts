import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison. Unequal lengths return false without comparing bytes. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
