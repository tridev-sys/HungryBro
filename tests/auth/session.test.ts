import { randomUUID } from 'node:crypto';
import {
  issueSession, verifySession, readSessionToken, sessionCookieOptions,
  DINER_SESSION_SECONDS,
} from '@/lib/auth/session';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'a'.repeat(40); });

const uid = randomUUID();
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const payloadOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

test('diner tokens last 30 days and carry the role claim', async () => {
  const { token, maxAgeSeconds } = await issueSession({ id: uid, role: 'diner' });
  expect(maxAgeSeconds).toBe(DINER_SESSION_SECONDS);
  expect(await verifySession(token)).toEqual({ userId: uid, role: 'diner' });
  const p = payloadOf(token);
  expect(p.exp - p.iat).toBe(2592000);
});

test('staff tokens last 12 hours', async () => {
  const { token, maxAgeSeconds } = await issueSession({ id: uid, role: 'restaurant_staff' });
  expect(maxAgeSeconds).toBe(43200);
  const p = payloadOf(token);
  expect(p.exp - p.iat).toBe(43200);
  expect((await verifySession(token))?.role).toBe('restaurant_staff');
});

test('a re-labelled role claim fails the signature (Review Focus 3)', async () => {
  const { token } = await issueSession({ id: uid, role: 'diner' });
  const [h, p, s] = token.split('.');
  const forged = b64url(JSON.stringify({ ...payloadOf(token), role: 'platform_admin' }));
  expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull();
});

test('an expired token is rejected (Review Focus 3)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { token } = await issueSession({ id: uid, role: 'diner' }, { nowSeconds: now - DINER_SESSION_SECONDS - 60 });
  expect(await verifySession(token)).toBeNull();
});

test('an unsigned alg=none token is rejected (Review Focus 3)', async () => {
  const token = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub: uid, role: 'platform_admin' }))}.`;
  expect(await verifySession(token)).toBeNull();
});

test('cookie attributes are HttpOnly, Secure, SameSite=Lax, Path=/', () => {
  expect(sessionCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 });
});

test('reads the session cookie from a Cookie header', () => {
  expect(readSessionToken('a=1; fos_session=x.y.z; b=2')).toBe('x.y.z');
  expect(readSessionToken('a=1')).toBeNull();
  expect(readSessionToken(null)).toBeNull();
});
