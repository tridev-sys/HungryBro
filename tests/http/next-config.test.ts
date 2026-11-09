import nextConfig from '@/next.config';
import { HSTS_HEADER } from '@/lib/http/security';

test('the x-powered-by header is disabled', () => {
  expect(nextConfig.poweredByHeader).toBe(false);
});

test('next.config sends HSTS only when the forwarded proto is https', async () => {
  const rules = await nextConfig.headers!();
  const hsts = rules.flatMap((r) =>
    r.headers.filter((h) => h.key === 'Strict-Transport-Security').map((h) => ({ ...h, has: r.has })),
  );
  expect(hsts).toHaveLength(1);
  expect(hsts[0].value).toBe(HSTS_HEADER);
  expect(hsts[0].has).toEqual([{ type: 'header', key: 'x-forwarded-proto', value: 'https' }]);
});

test('the static headers in next.config are unconditional and HSTS is not among them', async () => {
  const rules = await nextConfig.headers!();
  const unconditional = rules.filter((r) => !r.has);
  const keys = unconditional.flatMap((r) => r.headers.map((h) => h.key));
  expect(keys).toContain('Content-Security-Policy');
  expect(keys).toContain('X-Frame-Options');
  expect(keys).not.toContain('Strict-Transport-Security');
});
