import { z } from 'zod';
import { round2 } from '../pricing';
import { verifyHmac } from '../webhooks/hmac';
import { buildUpiIntentUrl } from './upi';
import {
  PaymentCreateError,
  WebhookPayloadError,
  WebhookSignatureError,
  type PaymentProvider,
  type UpiIntent,
  type UpiIntentRequest,
  type VerifiedPaymentEvent,
} from './types';

interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  merchantVpa: string;
  payeeName: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const WEBHOOK_WINDOW_MS = 300_000;

const eventSchema = z.object({
  type: z.string(),
  data: z.object({
    order: z.object({ order_id: z.string(), order_amount: z.number() }),
    payment: z.object({ cf_payment_id: z.union([z.string(), z.number()]) }),
  }).optional(),
});

export class CashfreeProvider implements PaymentProvider {
  readonly name = 'cashfree' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  // Sandbox until ops flips baseUrl. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING:
  // endpoint path, API version, header names, signed-string format, timestamp unit.
  constructor(private readonly cfg: CashfreeConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = cfg.baseUrl ?? 'https://sandbox.cashfree.com';
  }

  async createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent> {
    const res = await this.fetchImpl(`${this.baseUrl}/pg/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': this.cfg.clientId,
        'x-client-secret': this.cfg.clientSecret,
        'x-api-version': '2023-08-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        order_id: req.orderRef,
        order_amount: round2(req.amountInr),
        order_currency: 'INR',
        // Placeholder phone. Plan 05 must supply the diner's verified phone.
        customer_details: { customer_id: req.orderRef, customer_phone: '9999999999' },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new PaymentCreateError(`cashfree order create failed with status ${res.status}`);
    const json = (await res.json()) as { order_id?: unknown };
    if (typeof json.order_id !== 'string' || json.order_id.length === 0) {
      throw new PaymentCreateError('cashfree response has no order id');
    }
    return {
      provider: 'cashfree',
      providerOrderId: json.order_id,
      amountInr: req.amountInr,
      upiIntentUrl: buildUpiIntentUrl({
        vpa: this.cfg.merchantVpa,
        payeeName: this.cfg.payeeName,
        amountInr: req.amountInr,
        note: req.description,
        txnRef: json.order_id,
      }),
    };
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    nowMs: number = Date.now(),
  ): VerifiedPaymentEvent {
    // Timestamp window first, then the HMAC over timestamp + raw body.
    const ts = headers['x-webhook-timestamp'];
    if (!ts || !/^\d+$/.test(ts)) throw new WebhookSignatureError('cashfree webhook timestamp missing or malformed');
    if (Math.abs(nowMs - Number(ts) * 1000) > WEBHOOK_WINDOW_MS) {
      throw new WebhookSignatureError('cashfree webhook timestamp outside the allowed window');
    }
    const ok = verifyHmac({
      secret: this.cfg.webhookSecret,
      payload: ts + rawBody,
      signature: headers['x-webhook-signature'],
      encoding: 'base64',
    });
    if (!ok) throw new WebhookSignatureError('cashfree webhook signature check failed');

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WebhookPayloadError('cashfree webhook body is not JSON');
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) throw new WebhookPayloadError('cashfree webhook body is malformed');

    const eventType =
      parsed.data.type === 'PAYMENT_SUCCESS_WEBHOOK' ? 'payment.captured'
      : parsed.data.type === 'PAYMENT_FAILED_WEBHOOK' ? 'payment.failed'
      : 'ignored';
    const data = parsed.data.data;
    if (eventType !== 'ignored' && !data) throw new WebhookPayloadError('cashfree payment event has no data');

    return {
      provider: 'cashfree',
      providerEventId: data ? String(data.payment.cf_payment_id) : '',
      eventType,
      providerOrderId: data?.order.order_id ?? '',
      amountInr: data ? data.order.order_amount : 0,
    };
  }
}
