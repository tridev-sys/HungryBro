import { randomUUID } from 'node:crypto';
import { POST as ratingsPOST } from '@/app/api/ratings/route';
import { POST as razorpayPOST } from '@/app/api/webhooks/razorpay/route';

// Real routes, no database: the ratings route answers 401 before any query when there is no
// session cookie, and the Razorpay route answers 401 before any state change when the
// signature is missing. Both sit behind withApiGuards.

const freshIp = () => `203.0.113.${randomUUID()}`;

function ratingsReq(ip: string): Request {
  return new Request('http://localhost:3000/api/ratings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: '{}',
  });
}

test('a burst over the IP limit on a real route returns 429 with Retry-After', async () => {
  const ip = freshIp();
  const statuses: number[] = [];
  for (let i = 0; i < 130; i++) statuses.push((await ratingsPOST(ratingsReq(ip))).status);
  expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
  expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
  const denied = await ratingsPOST(ratingsReq(ip));
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  expect(denied.headers.get('x-frame-options')).toBe('DENY');
});

test('normal traffic from another client still reaches the handler', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await ratingsPOST(ratingsReq(freshIp()));
    expect(res.status).toBe(401);
  }
});

test('webhook signature check still runs first and rejects unsigned calls with 401, not 429', async () => {
  const ip = freshIp();
  const req = () => new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: '{"event":"payment.captured"}',
  });
  const res = await razorpayPOST(req());
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe('INVALID_SIGNATURE');
});
