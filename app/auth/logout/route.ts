import { SESSION_COOKIE, TOTP_PENDING_COOKIE } from '@/lib/auth/session';
import { withSecurityHeaders } from '@/lib/http/security';

// Clears the session cookie in the browser. The attributes match the ones it was set with
// (HttpOnly, Secure, SameSite=Lax, Path=/). The token itself is not revoked on the server: a copy of
// it stays valid until its expiry. Server-side revocation is a separate, open item.
const CLEAR = 'Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

export async function POST(): Promise<Response> {
  const res = new Response(null, {
    status: 303,
    headers: { Location: '/auth/login' },
  });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; ${CLEAR}`);
  res.headers.append('Set-Cookie', `${TOTP_PENDING_COOKIE}=; ${CLEAR}`);
  return withSecurityHeaders(res);
}
