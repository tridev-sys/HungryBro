import Redis from 'ioredis';

let client: Redis | undefined;

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return url;
}

/** Shared connection for PUBLISH and short commands. */
export function getRedis(): Redis {
  client ??= new Redis(redisUrl(), { maxRetriesPerRequest: 2 });
  return client;
}

/** A separate connection per subscription; a subscribed connection cannot run other commands. */
export function createSubscriber(): Redis {
  return new Redis(redisUrl(), { maxRetriesPerRequest: 2 });
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
