// Payment provider interface. Adapters only: no HTTP route and no order_refs write here.
// Plan 05 owns the webhook route and the settlement write (shared decision 8), and calls
// verifyWebhook before any state change.

export type PaymentProviderName = 'razorpay' | 'cashfree';

export interface UpiIntentRequest {
  orderRef: string;
  amountInr: number;
  description: string;
}

export interface UpiIntent {
  provider: PaymentProviderName;
  providerOrderId: string;
  amountInr: number;
  upiIntentUrl: string;
}

export interface VerifiedPaymentEvent {
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: 'payment.captured' | 'payment.failed' | 'ignored';
  providerOrderId: string;
  amountInr: number;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  // Throws PaymentCreateError on any create failure.
  createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent>;
  // Checks the signature (and, for Cashfree, the timestamp window) before parsing the body.
  // Throws WebhookSignatureError before JSON.parse on any failed check.
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, nowMs?: number): VerifiedPaymentEvent;
}

export class WebhookSignatureError extends Error {}
export class WebhookPayloadError extends Error {}
export class PaymentCreateError extends Error {}
