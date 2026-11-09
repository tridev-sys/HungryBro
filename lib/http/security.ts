// Keep this file free of Next.js imports: next.config.ts imports it.

/** Applied to every response. unsafe-inline is the documented trade-off until a nonce-based CSP lands. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(self)',
};

/**
 * HSTS is only meaningful over HTTPS (browsers ignore it over plain HTTP), so it is sent only
 * when the request arrived over TLS. Cloudflare SSL mode Flexible reaches the origin over HTTP,
 * so today no request qualifies; the header returns automatically once Full (strict) is adopted.
 */
export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

/** True when the request arrived over TLS: X-Forwarded-Proto (first hop) if set, else the URL scheme. */
export function isHttpsRequest(req: Request): boolean {
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded !== null) return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  return new URL(req.url).protocol === 'https:';
}

/**
 * Returns the same status, body, and headers as `res`, plus SECURITY_HEADERS, and HSTS when `req`
 * arrived over HTTPS. Without `req` no HSTS is sent (safe default).
 */
export function withSecurityHeaders(res: Response, req?: Request): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (req && isHttpsRequest(req)) headers.set('Strict-Transport-Security', HSTS_HEADER);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
