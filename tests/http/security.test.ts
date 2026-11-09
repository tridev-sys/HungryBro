import { withSecurityHeaders, SECURITY_HEADERS, HSTS_HEADER, isHttpsRequest } from '@/lib/http/security';

const plainReq = () => new Request('http://food-os-app:3000/api/x');
const httpsForwardedReq = () =>
  new Request('http://food-os-app:3000/api/x', { headers: { 'x-forwarded-proto': 'https' } });
const httpForwardedReq = () =>
  new Request('http://food-os-app:3000/api/x', { headers: { 'x-forwarded-proto': 'http' } });

test('every static security header is applied', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }), httpsForwardedReq());
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  expect(res.headers.get('permissions-policy')).toContain('microphone=(self)');
  expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(Object.keys(SECURITY_HEADERS)).toHaveLength(5);
  expect(SECURITY_HEADERS).not.toHaveProperty('Strict-Transport-Security');
});

test('HSTS is sent when the request arrived over HTTPS (X-Forwarded-Proto: https)', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }), httpsForwardedReq());
  expect(res.headers.get('strict-transport-security')).toBe(HSTS_HEADER);
  expect(HSTS_HEADER).toContain('max-age=31536000');
});

test('HSTS is sent when the request URL itself is HTTPS (no proxy header)', () => {
  const res = withSecurityHeaders(
    Response.json({ ok: true }),
    new Request('https://hungrybro.pacewisdom.in/api/x'),
  );
  expect(res.headers.get('strict-transport-security')).toBe(HSTS_HEADER);
});

test('HSTS is NOT sent over plain HTTP (no TLS, no forwarded proto)', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }), plainReq());
  expect(res.headers.get('strict-transport-security')).toBeNull();
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
});

test('HSTS is NOT sent when X-Forwarded-Proto says http', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }), httpForwardedReq());
  expect(res.headers.get('strict-transport-security')).toBeNull();
});

test('HSTS is NOT sent when no request is supplied (safe default)', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }));
  expect(res.headers.get('strict-transport-security')).toBeNull();
});

test('isHttpsRequest reads the forwarded proto and falls back to the URL scheme', () => {
  expect(isHttpsRequest(httpsForwardedReq())).toBe(true);
  expect(isHttpsRequest(httpForwardedReq())).toBe(false);
  expect(isHttpsRequest(plainReq())).toBe(false);
  expect(isHttpsRequest(new Request('https://example.test/'))).toBe(true);
});

test('existing response body and status are preserved', async () => {
  const res = withSecurityHeaders(Response.json({ ok: true }, { status: 201 }), httpsForwardedReq());
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
});
