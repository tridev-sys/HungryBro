import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RazorpayProvider } from '@/lib/payments/razorpay';
import { CashfreeProvider } from '@/lib/payments/cashfree';
import { WebhookSignatureError } from '@/lib/payments/types';
import { buildUpiIntentUrl } from '@/lib/payments/upi';

const fx = (f: string) => readFileSync(path.join(__dirname, '../fixtures/payments', f), 'utf8');
const rzCfg = { keyId: 'rzp_test_1', keySecret: 'sec', webhookSecret: 'rzwh', merchantVpa: 'food@hdfc', payeeName: 'Food OS' };
const cfCfg = { clientId: 'cf_1', clientSecret: 'sec', webhookSecret: 'cfwh', merchantVpa: 'food@icici', payeeName: 'Food OS' };

test('upi intent url encodes the amount with two decimals and the txn reference', () => {
  const url = buildUpiIntentUrl({ vpa: 'food@hdfc', payeeName: 'Food OS', amountInr: 698, note: 'Order 1', txnRef: 'order_TEST0001' });
  expect(url.startsWith('upi://pay?')).toBe(true);
  expect(url).toContain('am=698.00');
  expect(url).toContain('tr=order_TEST0001');
  expect(url).toContain('cu=INR');
});

test('razorpay creates an order in paise and returns a UPI intent', async () => {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(fx('razorpay-order.json')); }) as unknown as typeof fetch;
  const intent = await new RazorpayProvider({ ...rzCfg, fetchImpl: f }).createUpiIntent({ orderRef: 'ord-1', amountInr: 698, description: 'Order' });
  expect(calls[0].url).toBe('https://api.razorpay.com/v1/orders');
  expect(calls[0].body).toMatchObject({ amount: 69800, currency: 'INR', receipt: 'ord-1' });
  expect(intent).toMatchObject({ provider: 'razorpay', providerOrderId: 'order_TEST0001', amountInr: 698 });
});

test('razorpay verifies a valid captured webhook', () => {
  const raw = fx('razorpay-payment-captured.json');
  const sig = createHmac('sha256', 'rzwh').update(raw).digest('hex');
  const ev = new RazorpayProvider(rzCfg).verifyWebhook(raw, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' });
  expect(ev).toEqual({ provider: 'razorpay', providerEventId: 'evt_1', eventType: 'payment.captured', providerOrderId: 'order_TEST0001', amountInr: 698 });
});

test('razorpay rejects a forged webhook before parsing it (Review Focus 2)', () => {
  const raw = fx('razorpay-payment-captured.json');
  const parse = vi.spyOn(JSON, 'parse');
  expect(() => new RazorpayProvider(rzCfg).verifyWebhook(raw, { 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'evt_1' }))
    .toThrow(WebhookSignatureError);
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
});

test('cashfree creates an order in rupees and returns a UPI intent', async () => {
  const calls: { url: string; body: any; headers: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)), headers: init.headers }); return new Response(fx('cashfree-order.json')); }) as unknown as typeof fetch;
  const intent = await new CashfreeProvider({ ...cfCfg, fetchImpl: f }).createUpiIntent({ orderRef: 'ord-1', amountInr: 698, description: 'Order' });
  expect(calls[0].url).toBe('https://sandbox.cashfree.com/pg/orders');
  expect(calls[0].body).toMatchObject({ order_id: 'ord-1', order_amount: 698, order_currency: 'INR' });
  expect(intent).toMatchObject({ provider: 'cashfree', providerOrderId: 'ord-1', amountInr: 698 });
});

test('cashfree verifies a fresh signed webhook over timestamp plus body (epoch milliseconds)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = String(Date.now());
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  const ev = new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
  expect(ev).toMatchObject({ provider: 'cashfree', providerEventId: '555001:PAYMENT_SUCCESS_WEBHOOK', eventType: 'payment.captured', providerOrderId: 'ord-1', amountInr: 698 });
});

test('cashfree rejects a validly signed webhook older than the 5 minute window (milliseconds)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = String(Date.now() - 6 * 60 * 1000);
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  expect(() => new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, Date.now()))
    .toThrow(WebhookSignatureError);
});

test('cashfree treats a seconds-based timestamp as out of window (unit is milliseconds)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  expect(() => new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, Date.now()))
    .toThrow(WebhookSignatureError);
});

test('cashfree rejects a bad signature on a fresh millisecond timestamp before parsing (Review Focus 2)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = String(Date.now());
  const sig = createHmac('sha256', 'attacker').update(ts + raw).digest('base64');
  const parse = vi.spyOn(JSON, 'parse');
  expect(() => new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }))
    .toThrow(WebhookSignatureError);
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
});

test('cartesia TTS requests the sonic-3 model (sonic-2 is not in the current enum)', async () => {
  const { createCartesiaTts } = await import('@/lib/voice/providers/cartesia');
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
  const tts = createCartesiaTts({ apiKey: 'ct-test-key', voiceId: 'voice-1', fetchImpl: fetchImpl as unknown as typeof fetch });
  for await (const _chunk of tts.synthesize('two naan', 'en')) { /* drain */ }
  const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({ model_id: 'sonic-3' });
});

test('cartesia TTS sends bearer auth and the current Cartesia-Version on tts/bytes', async () => {
  const { createCartesiaTts } = await import('@/lib/voice/providers/cartesia');
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
  const tts = createCartesiaTts({ apiKey: 'ct-test-key', voiceId: 'voice-1', fetchImpl: fetchImpl as unknown as typeof fetch });
  for await (const _chunk of tts.synthesize('two naan', 'en')) { /* drain */ }
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  expect(url).toBe('https://api.cartesia.ai/tts/bytes');
  expect(headers.Authorization).toBe('Bearer ct-test-key');
  expect(headers['X-API-Key']).toBeUndefined();
  expect(headers['Cartesia-Version']).toBe('2026-08-14');
});

test('cashfree rejects a stale timestamp even with a valid signature (Review Focus 2)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = '1700000000';
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  expect(() => new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, Date.now()))
    .toThrow(WebhookSignatureError);
});
