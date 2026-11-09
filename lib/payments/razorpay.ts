import { z } from 'zod';
import { verifyHmac } from '../webhooks/hmac';
import { buildUpiIntentUrl } from './upi';
import {
  isDefiniteRefusal,
  PaymentCreateError,
  WebhookPayloadError,
  WebhookSignatureError,
  type PaymentProvider,
  type UpiIntent,
  type UpiIntentRequest,
  type VerifiedPaymentEvent,
} from './types';

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  merchantVpa: string;
  payeeName: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const eventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({
        entity: z.object({ order_id: z.string(), amount: z.number() }),
      }),
    })
    .optional(),
});

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  // VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: endpoint path, signature header, event id header.
  constructor(private readonly cfg: RazorpayConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = cfg.baseUrl ?? 'https://api.razorpay.com';
  }

  async createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/orders`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: Math.round(req.amountInr * 100), currency: 'INR', receipt: req.orderRef }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new PaymentCreateError(`razorpay order create failed with status ${res.status}`, isDefiniteRefusal(res.status));
    const json = (await res.json()) as { id?: unknown };
    if (typeof json.id !== 'string' || json.id.length === 0) {
      throw new PaymentCreateError('razorpay response has no order id', false);
    }
    return {
      provider: 'razorpay',
      providerOrderId: json.id,
      amountInr: req.amountInr,
      upiIntentUrl: buildUpiIntentUrl({
        vpa: this.cfg.merchantVpa,
        payeeName: this.cfg.payeeName,
        amountInr: req.amountInr,
        note: req.description,
        txnRef: json.id,
      }),
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): VerifiedPaymentEvent {
    const ok = verifyHmac({
      secret: this.cfg.webhookSecret,
      payload: rawBody,
      signature: headers['x-razorpay-signature'],
      encoding: 'hex',
    });
    if (!ok) throw new WebhookSignatureError('razorpay webhook signature check failed');

    const eventId = headers['x-razorpay-event-id'];
    if (!eventId) throw new WebhookPayloadError('razorpay webhook has no event id');

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WebhookPayloadError('razorpay webhook body is not JSON');
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) throw new WebhookPayloadError('razorpay webhook body is malformed');

    const eventType =
      parsed.data.event === 'payment.captured' ? 'payment.captured'
      : parsed.data.event === 'payment.failed' ? 'payment.failed'
      : 'ignored';
    const entity = parsed.data.payload?.payment.entity;
    if (eventType !== 'ignored' && !entity) throw new WebhookPayloadError('razorpay payment event has no payment entity');

    return {
      provider: 'razorpay',
      providerEventId: eventId,
      eventType,
      providerOrderId: entity?.order_id ?? '',
      amountInr: entity ? entity.amount / 100 : 0,
    };
  }
}
