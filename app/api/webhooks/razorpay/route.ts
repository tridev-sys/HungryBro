import { getPool } from '@/lib/db/client';
import { verifyRazorpaySignature, recordWebhookEvent } from '@/lib/payments/webhooks';

export async function POST(req: Request): Promise<Response> {
  // Read the raw text first; the signature is over these exact bytes. Parse JSON only after verification.
  const rawBody = await req.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  if (!verifyRazorpaySignature(rawBody, req.headers.get('x-razorpay-signature'), secret)) {
    return Response.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  }
  const eventId = req.headers.get('x-razorpay-event-id');
  if (!eventId) return Response.json({ error: 'MISSING_EVENT_ID' }, { status: 400 });

  const recorded = await recordWebhookEvent(await getPool(), 'razorpay', eventId);
  if (recorded === 'DUPLICATE') return Response.json({ error: 'DUPLICATE_EVENT' }, { status: 409 });
  // Plan 06 attaches payment-state changes here, after the NEW branch.
  return Response.json({ ok: true }, { status: 200 });
}
