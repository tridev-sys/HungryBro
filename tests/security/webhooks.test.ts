// Check 3: webhook forgery. Wrong, missing, tampered, stale, cross-tenant and replayed signatures
// must be rejected before any write, and the database must not change.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POST as razorpayPOST } from '@/app/api/webhooks/razorpay/route';
import { POST as cashfreePOST } from '@/app/api/webhooks/cashfree/route';
import { POST as posPOST } from '@/app/api/pos/[provider]/[restaurantId]/route';
import { prepareDatabase, closeAll, admin, buildWorld, type World } from './helpers';

const RZP_SECRET = 'sec-rzp-webhook-secret-7f3a9c';
const CF_SECRET = 'sec-cf-webhook-secret-19be02';
const savedEnv = { rzp: process.env.RAZORPAY_WEBHOOK_SECRET, cf: process.env.CASHFREE_WEBHOOK_SECRET };
let w: World;

beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = RZP_SECRET;
  process.env.CASHFREE_WEBHOOK_SECRET = CF_SECRET;
  await prepareDatabase();
  w = await buildWorld();
});
afterAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = savedEnv.rzp;
  process.env.CASHFREE_WEBHOOK_SECRET = savedEnv.cf;
  await closeAll();
});

const eventCount = async (provider: string, eventId?: string): Promise<number> => {
  const { rows } = eventId
    ? await admin.query('SELECT count(*)::int AS n FROM webhook_events WHERE provider = $1 AND event_id = $2', [provider, eventId])
    : await admin.query('SELECT count(*)::int AS n FROM webhook_events WHERE provider = $1', [provider]);
  return rows[0].n;
};

// Bodies updated (owner review item 6): both routes verify through the provider adapter, which needs the
// provider's real event shape (order id and amount). A valid event for an unknown order is recorded and answered 200.
const rzpBody = (id: string) => JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${id}`, order_id: `order_${id}`, amount: 1000 } } } });
const rzpSig = (body: string, secret = RZP_SECRET) => createHmac('sha256', secret).update(body).digest('hex');
const rzpReq = (body: string, headers: Record<string, string>) =>
  new Request('http://localhost:3000/api/webhooks/razorpay', { method: 'POST', headers, body });

describe('Razorpay webhook', () => {
  test('wrong signature is rejected 401 and records nothing', async () => {
    const id = `evt-wrong-${Date.now()}`;
    const before = await eventCount('razorpay');
    const res = await razorpayPOST(rzpReq(rzpBody(id), { 'x-razorpay-signature': rzpSig(rzpBody(id), 'attacker-secret'), 'x-razorpay-event-id': id }));
    expect(res.status).toBe(401);
    expect(await eventCount('razorpay')).toBe(before);
    expect(await eventCount('razorpay', id)).toBe(0);
  });

  test('missing signature is rejected 401 and records nothing', async () => {
    const id = `evt-missing-${Date.now()}`;
    const before = await eventCount('razorpay');
    const res = await razorpayPOST(rzpReq(rzpBody(id), { 'x-razorpay-event-id': id }));
    expect(res.status).toBe(401);
    expect(await eventCount('razorpay')).toBe(before);
  });

  test('a signature that is valid for a different body is rejected (tampered body)', async () => {
    const id = `evt-tamper-${Date.now()}`;
    const signedBody = rzpBody(id);
    const tamperedBody = signedBody.replace('1000', '1');
    const res = await razorpayPOST(rzpReq(tamperedBody, { 'x-razorpay-signature': rzpSig(signedBody), 'x-razorpay-event-id': id }));
    expect(res.status).toBe(401);
    expect(await eventCount('razorpay', id)).toBe(0);
  });

  test('a malformed signature (not 64 hex) is rejected 401', async () => {
    const id = `evt-malformed-${Date.now()}`;
    const res = await razorpayPOST(rzpReq(rzpBody(id), { 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': id }));
    expect(res.status).toBe(401);
  });

  test('a valid signature without an event id is rejected 400 and records nothing', async () => {
    const id = `evt-noid-${Date.now()}`;
    const res = await razorpayPOST(rzpReq(rzpBody(id), { 'x-razorpay-signature': rzpSig(rzpBody(id)) }));
    expect(res.status).toBe(400);
    expect(await eventCount('razorpay', id)).toBe(0);
  });

  test('a valid event is accepted once; the replay is rejected 409 and does not record twice', async () => {
    const id = `evt-replay-${Date.now()}`;
    const body = rzpBody(id);
    const headers = { 'x-razorpay-signature': rzpSig(body), 'x-razorpay-event-id': id };
    expect((await razorpayPOST(rzpReq(body, headers))).status).toBe(200);
    const replay = await razorpayPOST(rzpReq(body, headers));
    expect(replay.status).toBe(409);
    expect(await eventCount('razorpay', id)).toBe(1);
  });

  test('with no webhook secret configured, nothing is accepted', async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = '';
    try {
      const id = `evt-nosecret-${Date.now()}`;
      const body = rzpBody(id);
      // Updated (owner review item 6): the shared handler answers 503 WEBHOOK_NOT_CONFIGURED before any
      // verification or state change, instead of throwing.
      const res = await razorpayPOST(rzpReq(body, { 'x-razorpay-signature': rzpSig(body, ''), 'x-razorpay-event-id': id }));
      expect(res.status).toBe(503);
      expect(await eventCount('razorpay', id)).toBe(0);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    }
  });
});

describe('Cashfree webhook', () => {
  const cfBody = (id: string) => JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: `order_${id}`, order_amount: 10 }, payment: { cf_payment_id: id } } });
  const cfSig = (ts: string, body: string, secret = CF_SECRET) =>
    createHmac('sha256', secret).update(ts + body).digest('base64');
  const cfReq = (body: string, headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/webhooks/cashfree', { method: 'POST', headers, body });

  test('wrong signature is rejected 401 and records nothing', async () => {
    const ts = String(Date.now());
    const before = await eventCount('cashfree');
    const res = await cashfreePOST(cfReq(cfBody('cf1'), { 'x-webhook-timestamp': ts, 'x-webhook-signature': cfSig(ts, cfBody('cf1'), 'attacker') }));
    expect(res.status).toBe(401);
    expect(await eventCount('cashfree')).toBe(before);
  });

  test('missing timestamp is rejected 401', async () => {
    const res = await cashfreePOST(cfReq(cfBody('cf2'), { 'x-webhook-signature': cfSig(String(Date.now()), cfBody('cf2')) }));
    expect(res.status).toBe(401);
  });

  test('a validly signed but stale event (older than 5 minutes) is rejected 401 (replay window)', async () => {
    const ts = String(Date.now() - 10 * 60 * 1000);
    const body = cfBody('cf-stale');
    const res = await cashfreePOST(cfReq(body, { 'x-webhook-timestamp': ts, 'x-webhook-signature': cfSig(ts, body) }));
    expect(res.status).toBe(401);
    expect(await eventCount('cashfree', cfSig(ts, body))).toBe(0);
  });

  test('a valid fresh event is accepted once; the replay is rejected 409', async () => {
    const ts = String(Date.now());
    const body = cfBody('cf-ok-' + ts);
    const headers = { 'x-webhook-timestamp': ts, 'x-webhook-signature': cfSig(ts, body) };
    expect((await cashfreePOST(cfReq(body, headers))).status).toBe(200);
    expect((await cashfreePOST(cfReq(body, headers))).status).toBe(409);
  });
});

describe('POS webhook (petpooja, restaurant Y)', () => {
  const raw = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
  const menu = raw('petpooja-menu.json');
  const stockOut = raw('petpooja-stock-webhook.json'); // instock "0"
  const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');
  const post = (body: string, sig?: string, rid?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (sig !== undefined) headers['x-petpooja-signature'] = sig;
    const target = rid ?? w.rY;
    return posPOST(
      new Request(`http://localhost:3000/api/pos/petpooja/${target}`, { method: 'POST', headers, body }),
      { params: Promise.resolve({ provider: 'petpooja', restaurantId: target }) });
  };
  const stockOf = async (code: string) =>
    (await admin.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = $2', [w.rY, code])).rows[0]?.is_in_stock;

  test('a forged stock update (signed with another secret) is rejected and nothing changes', async () => {
    expect((await post(menu, sign(menu, w.yPosSecret))).status).toBe(200);
    const before = await stockOf('pp-naan-01');
    expect(before).toBe(true);
    const res = await post(stockOut, sign(stockOut, 'attacker-secret'));
    expect(res.status).toBe(401);
    expect(await stockOf('pp-naan-01')).toBe(before);
  });

  test('a stock update with no signature header is rejected 401', async () => {
    const res = await post(stockOut);
    expect(res.status).toBe(401);
    expect(await stockOf('pp-naan-01')).toBe(true);
  });

  test('a signature made with another restaurant secret is rejected (cross-tenant signing)', async () => {
    // Restaurant X's secret is not Y's secret, so a body signed with X's secret must not pass for Y.
    const res = await post(stockOut, sign(stockOut, 'sec-restaurant-x-secret-not-y'));
    expect(res.status).toBe(401);
  });

  test('a signature computed over a different body is rejected (tampered body)', async () => {
    const tampered = stockOut.replace('"0"', '"1"');
    const res = await post(tampered, sign(stockOut, w.yPosSecret));
    expect(res.status).toBe(401);
    expect(await stockOf('pp-naan-01')).toBe(true);
  });

  test('a valid stock update is accepted, and a replay of the same signed body is rejected', async () => {
    // Stock flips to out-of-stock with a valid signature, then back in stock with a newer valid signature.
    const inStock = stockOut.replace('"0"', '"1"');
    expect((await post(stockOut, sign(stockOut, w.yPosSecret))).status).toBe(200);
    expect(await stockOf('pp-naan-01')).toBe(false);
    expect((await post(inStock, sign(inStock, w.yPosSecret))).status).toBe(200);
    expect(await stockOf('pp-naan-01')).toBe(true);
    // Replaying the older, validly signed "out of stock" body must not revert the newer state.
    const replay = await post(stockOut, sign(stockOut, w.yPosSecret));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'replayed' });
    expect(await stockOf('pp-naan-01')).toBe(true);
  });

  test('a webhook addressed to a restaurant with a mismatched provider is rejected 404', async () => {
    const res = await post(stockOut, sign(stockOut, w.yPosSecret), '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
