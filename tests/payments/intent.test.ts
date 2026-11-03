import { buildUpiUri, FakePaymentIntentAdapter } from '@/lib/payments/intent';

test('the UPI URI carries the share amount with two decimals', () => {
  const uri = buildUpiUri({ payeeVpa: 'cafe@okaxis', payeeName: 'Nagarjuna Koramangala', amountInr: 220.5, reference: 'T4-1' });
  expect(uri.startsWith('upi://pay?')).toBe(true);
  expect(uri).toContain('pa=cafe@okaxis');
  expect(uri).toContain('am=220.50');
  expect(uri).toContain('cu=INR');
  expect(uri).toContain('pn=Nagarjuna%20Koramangala');
});

test('the fake reports pending until settled, then settled', async () => {
  const adapter = new FakePaymentIntentAdapter();
  const intent = await adapter.createUpiIntent({
    sessionId: 's1', shareIndex: 0, amountInr: 283.5, payeeVpa: 'cafe@okaxis', payeeName: 'Cafe', reference: 'T1-1',
  });
  expect(intent.provider).toBe('fake');
  expect(intent.amountInr).toBe(283.5);
  expect(intent.upiUri).toContain('am=283.50');
  expect(await adapter.getStatus(intent.intentId)).toBe('pending');
  adapter.settle(intent.intentId);
  expect(await adapter.getStatus(intent.intentId)).toBe('settled');
});

test('a zero or negative share is rejected', async () => {
  const adapter = new FakePaymentIntentAdapter();
  await expect(adapter.createUpiIntent({
    sessionId: 's1', shareIndex: 0, amountInr: 0, payeeVpa: 'cafe@okaxis', payeeName: 'Cafe', reference: 'x',
  })).rejects.toThrow(RangeError);
});
