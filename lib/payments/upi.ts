import { round2 } from '../pricing';

// Builds a UPI deep link. Every value is URL-encoded; the amount always has two decimals.
export function buildUpiIntentUrl(p: {
  vpa: string;
  payeeName: string;
  amountInr: number;
  note: string;
  txnRef: string;
}): string {
  const params: [string, string][] = [
    ['pa', p.vpa],
    ['pn', p.payeeName],
    ['am', round2(p.amountInr).toFixed(2)],
    ['tn', p.note],
    ['tr', p.txnRef],
    ['cu', 'INR'],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
