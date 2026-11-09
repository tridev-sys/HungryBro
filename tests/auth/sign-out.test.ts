import { POST } from '@/app/auth/logout/route';
import { SESSION_COOKIE, TOTP_PENDING_COOKIE } from '@/lib/auth/session';

// Server-side token revocation is not implemented. This test covers only the cookie the browser holds.

/** Splits a Set-Cookie header into its name=value pair and lower-cased attribute tokens. */
function parseSetCookie(header: string): { name: string; value: string; attrs: string[] } {
  const [pair, ...rest] = header.split(';').map((p) => p.trim());
  const eq = pair.indexOf('=');
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attrs: rest.map((a) => a.toLowerCase()),
  };
}

test('sign-out clears the session cookie with the same flags it was set with', async () => {
  const res = await POST();
  const cookies = res.headers.getSetCookie().map(parseSetCookie);
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session).toBeDefined();
  expect(session?.value).toBe('');
  expect(session?.attrs).toEqual(expect.arrayContaining([
    'path=/', 'httponly', 'secure', 'samesite=lax', 'max-age=0',
  ]));
});

test('sign-out also clears a pending second-factor cookie, if one is left', async () => {
  const res = await POST();
  const pending = res.headers.getSetCookie().map(parseSetCookie).find((c) => c.name === TOTP_PENDING_COOKIE);
  expect(pending?.value).toBe('');
  expect(pending?.attrs).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'max-age=0']));
});

test('sign-out redirects to the sign-in page', async () => {
  const res = await POST();
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/auth/login');
});
