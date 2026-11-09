// The one verification path for every payment webhook. Order: bounded raw body, provider adapter
// verification (signature and freshness, before any parsing), then one database call that records
// the event and changes order state in the same transaction. No state change happens before verify.
import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { PayloadTooLargeError, readTextWithLimit } from '@/lib/http/body';
import { RazorpayProvider } from './razorpay';
import { CashfreeProvider } from './cashfree';
import {
  WebhookPayloadError, WebhookSignatureError, type PaymentProvider, type PaymentProviderName,
} from './types';

const json = (body: unknown, status: number) => Response.json(body, { status });

/**
 * A provider that can verify webhooks. Only the webhook secret is used here. Keys for creating
 * orders are not needed, so they are empty. Null when the secret is not configured (nothing accepted).
 */
export function webhookProviderFromEnv(name: PaymentProviderName, env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  if (name === 'razorpay') {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    return secret ? new RazorpayProvider({ keyId: '', keySecret: '', webhookSecret: secret, merchantVpa: '', payeeName: '' }) : null;
  }
  const secret = env.CASHFREE_WEBHOOK_SECRET;
  return secret ? new CashfreeProvider({ clientId: '', clientSecret: '', webhookSecret: secret, merchantVpa: '', payeeName: '' }) : null;
}

export async function handleProviderWebhook(
  req: Request,
  name: PaymentProviderName,
  pool: pg.Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  let raw: string;
  try {
    raw = await readTextWithLimit(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
    throw err;
  }

  const provider = webhookProviderFromEnv(name, env);
  if (!provider) return json({ error: 'WEBHOOK_NOT_CONFIGURED' }, 503);

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });
  let event;
  try {
    event = provider.verifyWebhook(raw, headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return json({ error: 'INVALID_SIGNATURE' }, 401);
    if (err instanceof WebhookPayloadError) return json({ error: 'INVALID_PAYLOAD' }, 400);
    throw err;
  }

  // Integer paise from the verified amount. The database compares it with the stored total.
  const amountPaise = Math.round(event.amountInr * 100);
  const result = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ r: string }>(
      'SELECT app_apply_payment_event($1, $2, $3, $4, $5::bigint) AS r',
      [name, event.providerEventId, event.eventType, event.providerOrderId, amountPaise]);
    return rows[0].r;
  });

  if (result === 'DUPLICATE') return json({ error: 'DUPLICATE_EVENT' }, 409);
  if (result === 'AMOUNT_MISMATCH') return json({ error: 'AMOUNT_MISMATCH' }, 422);
  return json({ ok: true, result }, 200);
}
