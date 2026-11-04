import { createHmac } from 'node:crypto';
import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { constantTimeEqual } from '@/lib/security/timing';

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING (Cashfree): the signed string, base64 encoding,
// and the timestamp unit. This module uses epoch milliseconds, the same unit as lib/payments/cashfree.ts
// (fixed in d411f82; Plan 06 originally said seconds). The production unit is NOT VERIFIED until a live Cashfree webhook is checked.
export const CASHFREE_TOLERANCE_MS = 300_000;

const HEX_SIG = /^[0-9a-f]{64}$/i;

function requireSecret(secret: string): void {
  if (!secret) throw new Error('webhook secret is not configured');
}

/** Razorpay: HMAC-SHA256 hex over the exact raw body, compared in constant time. */
export function verifyRazorpaySignature(rawBody: string, signatureHex: string | null, secret: string): boolean {
  requireSecret(secret);
  if (!signatureHex || !HEX_SIG.test(signatureHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return constantTimeEqual(expected, signatureHex.toLowerCase());
}

/** Cashfree: HMAC-SHA256 base64 over timestamp + raw body, with a 5-minute freshness window. */
export function verifyCashfreeSignature(args: {
  rawBody: string;
  timestamp: string | null;
  signatureB64: string | null;
  secret: string;
  nowMs: number;
  toleranceMs?: number;
}): boolean {
  const { rawBody, timestamp, signatureB64, secret, nowMs, toleranceMs = CASHFREE_TOLERANCE_MS } = args;
  requireSecret(secret);
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  if (!signatureB64) return false;
  if (Math.abs(nowMs - Number(timestamp)) > toleranceMs) return false;
  const expected = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  return constantTimeEqual(expected, signatureB64);
}

/** Records a provider event id once. Call only after the signature has been verified. */
export async function recordWebhookEvent(
  pool: pg.Pool,
  provider: 'razorpay' | 'cashfree',
  eventId: string,
): Promise<'NEW' | 'DUPLICATE'> {
  const inserted = await asRole(pool, null, async (c) => {
    const { rowCount } = await c.query(
      'INSERT INTO webhook_events (provider, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1',
      [provider, eventId]);
    return rowCount === 1;
  });
  return inserted ? 'NEW' : 'DUPLICATE';
}
