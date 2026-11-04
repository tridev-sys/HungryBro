import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@/types/food-os';

export const SESSION_COOKIE = 'fos_session';
export const DINER_SESSION_SECONDS = 2592000; // 30 days
export const STAFF_SESSION_SECONDS = 43200; // 12 hours
export const TOTP_PENDING_COOKIE = 'fos_2fa_pending';
export const TOTP_PENDING_SECONDS = 300; // 5 minutes between the email code and the authenticator code

const ROLES: readonly UserRole[] = ['guest', 'diner', 'restaurant_staff', 'kitchen_lead', 'delivery_agent', 'platform_admin'];

export interface SessionClaims {
  userId: string;
  role: UserRole;
}

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_JWT_SECRET must be set and at least 32 characters');
  return new TextEncoder().encode(secret);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export async function issueSession(
  user: { id: string; role: UserRole },
  opts: { nowSeconds?: number } = {},
): Promise<{ token: string; maxAgeSeconds: number }> {
  const now = opts.nowSeconds ?? nowSec();
  const maxAgeSeconds = user.role === 'diner' ? DINER_SESSION_SECONDS : STAFF_SESSION_SECONDS;
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(signingKey());
  return { token, maxAgeSeconds };
}

export async function verifySession(
  token: string | null | undefined,
  opts: { nowSeconds?: number } = {},
): Promise<SessionClaims | null> {
  if (!token) return null;
  const now = opts.nowSeconds ?? nowSec();
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ['HS256'],
      currentDate: new Date(now * 1000),
    });
    // Pending second-factor tokens carry a purpose claim and no role, so they are never sessions.
    if (payload.purpose !== undefined) return null;
    const role = payload.role as UserRole | undefined;
    if (typeof payload.sub !== 'string' || !role || !ROLES.includes(role)) return null;
    return { userId: payload.sub, role };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number): {
  httpOnly: true; secure: true; sameSite: 'lax'; path: '/'; maxAge: number;
} {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds };
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/** Short-lived token between the email code and the authenticator code. Never a session. */
export async function issuePendingSecondFactor(userId: string, opts: { nowSeconds?: number } = {}): Promise<string> {
  const now = opts.nowSeconds ?? nowSec();
  return new SignJWT({ purpose: 'totp-pending' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOTP_PENDING_SECONDS)
    .sign(signingKey());
}

export async function readPendingSecondFactor(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (payload.purpose !== 'totp-pending' || typeof payload.sub !== 'string') return null;
    return payload.sub;
  } catch {
    return null;
  }
}
