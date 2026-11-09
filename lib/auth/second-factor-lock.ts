import type { RedisLike } from '@/lib/ratelimit/redis-store';

// Guesses at the second factor (authenticator or recovery code) are counted per user, so a new
// pending token or a new email step does not reset the count. Each attempt is reserved before the
// code is checked. A concurrent burst therefore cannot run more than the limit of checks in one window.
export const SECOND_FACTOR_MAX_ATTEMPTS = 5;
export const SECOND_FACTOR_WINDOW_MS = 15 * 60 * 1000;

const keyFor = (userId: string) => `rl:2fa:${userId}`;

// Returns the attempt number. The window starts at the first attempt and ends SECOND_FACTOR_WINDOW_MS later.
const RESERVE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/** True when this attempt may be checked. False once the user has used up the window's attempts. */
export async function reserveSecondFactorAttempt(redis: RedisLike, userId: string): Promise<boolean> {
  const n = Number(await redis.eval(RESERVE_LUA, 1, keyFor(userId), SECOND_FACTOR_WINDOW_MS));
  return n <= SECOND_FACTOR_MAX_ATTEMPTS;
}

/** Called after a successful second factor, so a correct sign-in resets the count. */
export async function clearSecondFactorAttempts(redis: RedisLike, userId: string): Promise<void> {
  await redis.eval(`return redis.call('DEL', KEYS[1])`, 1, keyFor(userId));
}
