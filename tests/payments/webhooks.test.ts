import { createHmac, randomUUID } from 'node:crypto';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { constantTimeEqual } from '@/lib/security/timing';
import {
  verifyRazorpaySignature, verifyCashfreeSignature, recordWebhookEvent,
} from '@/lib/payments/webhooks';
import { POST as razorpayPost } from '@/app/api/webhooks/razorpay/route';
import { POST as cashfreePost } from '@/app/api/webhooks/cashfree/route';
import { ensureAppLogin } from '../helpers/db';

const pool = getAdminPool();
const RZ = 'rz_secret_test_value';
const CF = 'cf_secret_test_value';
const body = JSON.stringify({ event: 'payment.captured', payload: { amount: 71000 } });

beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = RZ;
  process.env.CASHFREE_WEBHOOK_SECRET = CF;
  await runMigrations(pool);
  await ensureAppLogin(pool);
});
afterAll(async () => { await pool.end(); });

const rzSig = (b: string, s = RZ) => createHmac('sha256', s).update(b).digest('hex');
const cfSig = (ts: string, b: string, s = CF) => createHmac('sha256', s).update(ts + b).digest('base64');

test('constantTimeEqual compares strings and rejects unequal lengths', () => {
  expect(constantTimeEqual('abc', 'abc')).toBe(true);
  expect(constantTimeEqual('abc', 'abd')).toBe(false);
  expect(constantTimeEqual('abc', 'abcd')).toBe(false);
});

test('Razorpay: valid signature passes; forged, altered, or missing signature fails (Review Focus 4)', () => {
  expect(verifyRazorpaySignature(body, rzSig(body), RZ)).toBe(true);
  expect(verifyRazorpaySignature(body, rzSig(body, 'wrong'), RZ)).toBe(false);
  expect(verifyRazorpaySignature(body.replace('71000', '1'), rzSig(body), RZ)).toBe(false);
  expect(verifyRazorpaySignature(body, null, RZ)).toBe(false);
  expect(verifyRazorpaySignature(body, 'short', RZ)).toBe(false);
});

test('Cashfree: valid signature inside the 5-minute window passes; stale timestamp fails', () => {
  const now = Date.now();
  const ts = String(now);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: ts, signatureB64: cfSig(ts, body), secret: CF, nowMs: now })).toBe(true);
  const old = String(now - 6 * 60 * 1000);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: old, signatureB64: cfSig(old, body), secret: CF, nowMs: now })).toBe(false);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: ts, signatureB64: cfSig(ts, body, 'x'), secret: CF, nowMs: now })).toBe(false);
});

test('recordWebhookEvent: first delivery is NEW, replay is DUPLICATE (Review Focus 4)', async () => {
  const id = `evt_${randomUUID()}`;
  expect(await recordWebhookEvent(pool, 'razorpay', id)).toBe('NEW');
  expect(await recordWebhookEvent(pool, 'razorpay', id)).toBe('DUPLICATE');
});

// Stale test body updated (owner review item 6, delivery flow): both routes now verify through the
// provider adapter, which parses the provider's real event shape, so the bodies below match it.
// The order id is unknown here, so a valid event is recorded and answered 200 with result UNKNOWN_ORDER.
test('Razorpay route: forged 401, valid 200, replayed 409', async () => {
  const id = `evt_${randomUUID()}`;
  const rzBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: `order_${randomUUID()}`, amount: 71000 } } } });
  const mk = (sig: string) => new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': id, 'content-type': 'application/json' },
    body: rzBody,
  });
  expect((await razorpayPost(mk(rzSig(rzBody, 'forged')))).status).toBe(401);
  expect((await razorpayPost(mk(rzSig(rzBody)))).status).toBe(200);
  expect((await razorpayPost(mk(rzSig(rzBody)))).status).toBe(409);
});

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: Cashfree header names and timestamp unit.
test('Cashfree route: forged 401, valid 200, replayed 409', async () => {
  const ts = String(Date.now());
  const cfBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: `order_${randomUUID()}`, order_amount: 710 }, payment: { cf_payment_id: randomUUID() } } });
  const sig = cfSig(ts, cfBody);
  const mk = (s: string) => new Request('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: { 'x-webhook-timestamp': ts, 'x-webhook-signature': s, 'content-type': 'application/json' },
    body: cfBody,
  });
  expect((await cashfreePost(mk(cfSig(ts, cfBody, 'forged')))).status).toBe(401);
  expect((await cashfreePost(mk(sig))).status).toBe(200);
  expect((await cashfreePost(mk(sig))).status).toBe(409);
});
