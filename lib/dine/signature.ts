import { randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 hex characters, carried in the table QR URL as ?sig=. */
export function issueSignatureToken(): string {
  return randomBytes(16).toString('hex');
}

/** 64 hex characters, stored in the fos_table_session cookie. */
export function issueSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time check. Length mismatch returns false before timingSafeEqual, which would throw. */
export function verifyTableSignature(stored: string, presented: string | null | undefined): boolean {
  if (!presented || presented.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(presented));
}
