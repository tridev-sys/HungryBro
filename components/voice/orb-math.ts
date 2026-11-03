export const ORB_REDUCED_MOTION_SCALE = 1.1;

export function orbScale(level: number): number {
  if (!Number.isFinite(level)) return 1;
  const clamped = Math.min(1, Math.max(0, level));
  return 1 + 0.35 * clamped;
}
