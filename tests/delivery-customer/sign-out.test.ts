import { issueSession, SESSION_COOKIE } from '@/lib/auth/session';
import { POST as signOut } from '@/app/api/auth/sign-out/route';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'a'.repeat(40); });

test('sign-out clears the session cookie and redirects home', async () => {
  const res = await signOut(new Request('http://t/api/auth/sign-out', {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${(await issueSession({ id: '00000000-0000-4000-8000-000000000001', role: 'diner' })).token}`, 'x-forwarded-for': '203.0.113.70' },
  }));
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/');
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain(`${SESSION_COOKIE}=`);
  expect(setCookie).toMatch(/Max-Age=0/);
  expect(setCookie).toMatch(/HttpOnly/);
});

test('sign-out without a session still clears and redirects (idempotent)', async () => {
  const res = await signOut(new Request('http://t/api/auth/sign-out', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.71' } }));
  expect(res.status).toBe(303);
});
