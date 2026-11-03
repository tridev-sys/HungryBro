import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacCheck {
  secret: string;
  payload: string;
  signature: string | undefined;
  encoding: 'hex' | 'base64';
}

export function verifyHmac({ secret, payload, signature, encoding }: HmacCheck): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest(encoding);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(encoding === 'hex' ? signature.trim().toLowerCase() : signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
