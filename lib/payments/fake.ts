import { buildUpiUri, type PaymentIntentAdapter, type UpiIntent, type UpiIntentRequest } from './intent';

/** In-memory adapter for tests and development. Never calls a payment provider. */
export class FakePaymentIntentAdapter implements PaymentIntentAdapter {
  private readonly intents = new Map<string, 'pending' | 'settled'>();
  private counter = 0;

  async createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent> {
    if (!(req.amountInr > 0)) throw new RangeError(`share amount must be positive, got ${req.amountInr}`);
    const intentId = `fake_${++this.counter}`;
    this.intents.set(intentId, 'pending');
    return {
      intentId,
      provider: 'fake',
      amountInr: req.amountInr,
      upiUri: buildUpiUri({
        payeeVpa: req.payeeVpa,
        payeeName: req.payeeName,
        amountInr: req.amountInr,
        reference: req.reference,
      }),
    };
  }

  async getStatus(intentId: string): Promise<'pending' | 'settled'> {
    const status = this.intents.get(intentId);
    if (!status) throw new Error(`UNKNOWN_INTENT ${intentId}`);
    return status;
  }

  /** Test and dev only: marks an intent as paid. */
  settle(intentId: string): void {
    if (!this.intents.has(intentId)) throw new Error(`UNKNOWN_INTENT ${intentId}`);
    this.intents.set(intentId, 'settled');
  }
}
