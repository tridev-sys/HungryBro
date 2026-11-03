// Payment intent adapter for dine-in shares. Interfaces and the UPI URI builder; no I/O here.
import { round2 } from '../pricing';

export interface UpiIntentRequest {
  sessionId: string;
  shareIndex: number;
  amountInr: number;
  payeeVpa: string;
  payeeName: string;
  reference: string;
}

export interface UpiIntent {
  intentId: string;
  provider: 'fake' | 'razorpay' | 'cashfree';
  amountInr: number;
  upiUri: string;
}

export interface PaymentIntentAdapter {
  createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent>;
  getStatus(intentId: string): Promise<'pending' | 'settled'>;
}

const enc = (v: string): string => encodeURIComponent(v).replace(/%40/g, '@');

/**
 * `upi://pay?...` for one share. The amount has two decimals and the reference goes in tn and tr.
 * The VPA keeps a literal '@' (a valid UPI VPA form); lib/payments/upi.ts is left unchanged for Plan 06.
 */
export function buildUpiUri(p: { payeeVpa: string; payeeName: string; amountInr: number; reference: string }): string {
  const params: [string, string][] = [
    ['pa', p.payeeVpa],
    ['pn', p.payeeName],
    ['am', round2(p.amountInr).toFixed(2)],
    ['cu', 'INR'],
    ['tn', p.reference],
    ['tr', p.reference],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

// Re-exported so callers can import the fake from the interface module.
export { FakePaymentIntentAdapter } from './fake';
