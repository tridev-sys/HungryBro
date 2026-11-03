import Redis from 'ioredis';
import { encodeGeohash, geohashBlock, meshChannel } from './geohash';
import { REDIS_BOUNDED_OPTIONS } from '@/lib/redis';
import type { LatLng } from '@/types/food-os';

// Redis Pub/Sub fan-out only. The database is the record; Redis holds no auction state.
export interface MeshBus {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(
    channels: string[],
    onMessage: (channel: string, message: unknown) => void,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

// Connection errors surface as rejected commands (see REDIS_BOUNDED_OPTIONS). The listener only
// stops ioredis from logging each reconnect attempt as an unhandled event.
function newConnection(url: string): Redis {
  const conn = new Redis(url, REDIS_BOUNDED_OPTIONS);
  conn.on('error', () => undefined);
  return conn;
}

// quit() on a connection that never came up can itself wait on the offline queue, so fall back
// to disconnect().
async function closeConnection(conn: Redis): Promise<void> {
  await conn.quit().catch(() => conn.disconnect());
}

export function createMeshBus(redisUrl: string | undefined = process.env.REDIS_URL): MeshBus {
  if (!redisUrl) throw new Error('REDIS_URL is not set');
  const url = redisUrl;
  const publisher = newConnection(url);
  const subscribers = new Set<Redis>();

  return {
    async publish(channel, message) {
      await publisher.publish(channel, JSON.stringify(message));
    },
    async subscribe(channels, onMessage) {
      // ioredis needs a dedicated connection per subscriber.
      const sub = newConnection(url);
      subscribers.add(sub);
      sub.on('message', (channel: string, raw: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        onMessage(channel, parsed);
      });
      await sub.subscribe(...channels);
      return async () => {
        subscribers.delete(sub);
        await closeConnection(sub);
      };
    },
    async close() {
      const subs = [...subscribers];
      subscribers.clear();
      await Promise.all(subs.map(closeConnection));
      await closeConnection(publisher);
    },
  };
}

export async function publishIntentToBlock(bus: MeshBus, point: LatLng, payload: object): Promise<string[]> {
  const channels = geohashBlock(encodeGeohash(point)).map(meshChannel);
  await Promise.all(channels.map((ch) => bus.publish(ch, payload)));
  return channels;
}
