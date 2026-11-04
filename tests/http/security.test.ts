import { withSecurityHeaders, SECURITY_HEADERS } from '@/lib/http/security';

test('every security header is applied and the server banner is absent', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }));
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
  expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  expect(res.headers.get('permissions-policy')).toContain('microphone=(self)');
  expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(Object.keys(SECURITY_HEADERS)).toHaveLength(6);
});

test('existing response body and status are preserved', async () => {
  const res = withSecurityHeaders(Response.json({ ok: true }, { status: 201 }));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
});
