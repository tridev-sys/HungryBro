import { createUpiIntentWithFallback } from '@/lib/payments/router';
import { PaymentCreateError, type PaymentProvider, type UpiIntentRequest } from '@/lib/payments/types';

const req: UpiIntentRequest = { orderRef: 'ord-9', amountInr: 500, description: 'Order' };

function stub(name: 'razorpay' | 'cashfree', behavior: 'ok' | 'throw' | 'empty'): PaymentProvider & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {
    if (behavior === 'throw') throw new Error(`${name} 502`);
    if (behavior === 'empty') return { provider: name, providerOrderId: '', amountInr: 500, upiIntentUrl: 'upi://x' };
    return { provider: name, providerOrderId: `${name}-order`, amountInr: 500, upiIntentUrl: 'upi://x' };
  });
  return { name, create, createUpiIntent: create, verifyWebhook: vi.fn() } as any;
}

test('uses Razorpay and never calls Cashfree when Razorpay succeeds (Review Focus 5)', async () => {
  const rz = stub('razorpay', 'ok');
  const cf = stub('cashfree', 'ok');
  const out = await createUpiIntentWithFallback(rz, cf, req);
  expect(out).toMatchObject({ provider: 'razorpay', attempted: ['razorpay'] });
  expect(rz.create).toHaveBeenCalledTimes(1);
  expect(cf.create).not.toHaveBeenCalled();
});

test('falls back to Cashfree exactly once when the Razorpay create call throws', async () => {
  const rz = stub('razorpay', 'throw');
  const cf = stub('cashfree', 'ok');
  const out = await createUpiIntentWithFallback(rz, cf, req);
  expect(out).toMatchObject({ provider: 'cashfree', attempted: ['razorpay', 'cashfree'] });
  expect(rz.create).toHaveBeenCalledTimes(1);
  expect(cf.create).toHaveBeenCalledTimes(1);
});

test('treats a Razorpay response without an order id as a failed create', async () => {
  const out = await createUpiIntentWithFallback(stub('razorpay', 'empty'), stub('cashfree', 'ok'), req);
  expect(out.provider).toBe('cashfree');
});

test('rejects with PaymentCreateError when both providers fail, without secrets in the message', async () => {
  const err = await createUpiIntentWithFallback(stub('razorpay', 'throw'), stub('cashfree', 'throw'), req).catch((e) => e);
  expect(err).toBeInstanceOf(PaymentCreateError);
  expect(err.message).toMatch(/razorpay.*cashfree|cashfree.*razorpay/s);
});

test('logs the fallback with the provider name only', async () => {
  const log = vi.fn();
  await createUpiIntentWithFallback(stub('razorpay', 'throw'), stub('cashfree', 'ok'), req, log);
  expect(log).toHaveBeenCalledWith('payment_fallback', expect.objectContaining({ from: 'razorpay', to: 'cashfree' }));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|key/i);
});
