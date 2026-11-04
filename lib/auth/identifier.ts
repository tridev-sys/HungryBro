import { normalizeIndianMobile } from './phone';

// The sign-in identifier: an Indian mobile number (E.164) or an email address (normalised).
// Anything with an '@' is treated as an email and never as a phone number.
export type Identifier = { kind: 'phone'; value: string } | { kind: 'email'; value: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lowercased, length-checked. Returns null when the address is not usable. */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length < 3 || v.length > 254 || !EMAIL_RE.test(v)) return null;
  return v;
}

export function normalizeIdentifier(raw: string): Identifier | null {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed);
    return email ? { kind: 'email', value: email } : null;
  }
  const phone = normalizeIndianMobile(trimmed);
  return phone ? { kind: 'phone', value: phone } : null;
}
