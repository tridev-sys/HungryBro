import Redis, { type RedisOptions } from 'ioredis';

let client: Redis | undefined;

/**
 * Bounded failure for every Redis client. ioredis defaults retry each command about 20 times
 * with no connect timeout, so a dead Redis hangs requests. With these options a queued command
 * rejects after one reconnect round (maxRetriesPerRequest 1), each attempt gives up after
 * connectTimeout, and reconnects back off at most 1 s. Callers see a rejection, not a hang.
 */
export const REDIS_BOUNDED_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  retryStrategy: (times) => Math.min(times * 100, 1000),
};

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return url;
}

/** Shared connection for PUBLISH and short commands. */
export function getRedis(): Redis {
  client ??= new Redis(redisUrl(), REDIS_BOUNDED_OPTIONS);
  return client;
}

/** A separate connection per subscription; a subscribed connection cannot run other commands. */
export function createSubscriber(): Redis {
  return new Redis(redisUrl(), REDIS_BOUNDED_OPTIONS);
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
