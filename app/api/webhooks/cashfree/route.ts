import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { verifyCashfreeSignature, recordWebhookEvent } from '@/lib/payments/webhooks';

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header names x-webhook-timestamp and x-webhook-signature.
// Open item: the event id is the signature header value here; Plan 06 uses data.payment.cf_payment_id.
async function handlePost(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature');
  const verified = verifyCashfreeSignature({
    rawBody,
    timestamp: req.headers.get('x-webhook-timestamp'),
    signatureB64: signature,
    secret: process.env.CASHFREE_WEBHOOK_SECRET ?? '',
    nowMs: Date.now(),
  });
  if (!verified) return Response.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  if (!signature) return Response.json({ error: 'MISSING_EVENT_ID' }, { status: 400 });

  const recorded = await recordWebhookEvent(await getPool(), 'cashfree', signature);
  if (recorded === 'DUPLICATE') return Response.json({ error: 'DUPLICATE_EVENT' }, { status: 409 });
  return Response.json({ ok: true }, { status: 200 });
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
