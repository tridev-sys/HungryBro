import '@testing-library/jest-dom/vitest';
import { afterAll, beforeEach } from 'vitest';
import { closeRedis, getRedis } from '@/lib/redis';
import { bucketKeyForIp } from '@/lib/ratelimit/keys';

// Route tests call handlers without a client IP, so guardRateLimit keys them all to
// rl:ip:unknown. That bucket lives in shared Redis for about two minutes, so one test's
// requests would count against the next. Reset only that key before each test. Tests that
// need a specific IP still send their own X-Real-IP and are unaffected.
beforeEach(async () => {
  await getRedis().del(bucketKeyForIp('unknown'));
});

afterAll(async () => {
  await closeRedis();
});
