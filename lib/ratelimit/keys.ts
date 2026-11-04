import { createHash } from 'node:crypto';

/** Bucket key for a client IP. */
export function bucketKeyForIp(ip: string): string {
  return `rl:ip:${ip}`;
}

/** Bucket key for a session. The raw token never reaches Redis. */
export function bucketKeyForSession(sessionToken: string): string {
  const digest = createHash('sha256').update(sessionToken).digest('hex');
  return `rl:sess:${digest.slice(0, 32)}`;
}

/**
 * Client IP. Caddy overwrites X-Real-IP with the TCP peer address, so it is trusted first.
 * The fallback is the RIGHTMOST X-Forwarded-For entry (the one Caddy appended). The leftmost
 * entry is client-controlled and is never used.
 */
export function clientIpFromHeaders(h: Headers): string {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return 'unknown';
}
