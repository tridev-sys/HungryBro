import Redis from 'ioredis';
import { encodeGeohash, geohashBlock, meshChannel } from './geohash';
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

export function createMeshBus(redisUrl: string | undefined = process.env.REDIS_URL): MeshBus {
  if (!redisUrl) throw new Error('REDIS_URL is not set');
  const url = redisUrl;
  const publisher = new Redis(url);
  const subscribers = new Set<Redis>();

  return {
    async publish(channel, message) {
      await publisher.publish(channel, JSON.stringify(message));
    },
    async subscribe(channels, onMessage) {
      // ioredis needs a dedicated connection per subscriber.
      const sub = new Redis(url);
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
        await sub.quit();
      };
    },
    async close() {
      const subs = [...subscribers];
      subscribers.clear();
      await Promise.all(subs.map((s) => s.quit()));
      await publisher.quit();
    },
  };
}

export async function publishIntentToBlock(bus: MeshBus, point: LatLng, payload: object): Promise<string[]> {
  const channels = geohashBlock(encodeGeohash(point)).map(meshChannel);
  await Promise.all(channels.map((ch) => bus.publish(ch, payload)));
  return channels;
}
