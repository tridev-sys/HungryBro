// Check 4: session handling. Forged, expired, tampered and wrong-role cookies are rejected, and the
// x-dev-diner override is honoured only under NODE_ENV=test.
import { SignJWT } from 'jose';
import { issueSession, verifySession, readSessionToken, SESSION_COOKIE } from '@/lib/auth/session';
import { resolveDiner, HttpError } from '@/lib/delivery/diner';
import { POST as intentPOST } from '@/app/api/delivery/intent/route';
import { POST as ratingsPOST } from '@/app/api/ratings/route';
import { prepareDatabase, closeAll, admin, buildWorld, type World, sessionCookie, jsonRequest } from './helpers';

const DAY = 86400;
let w: World;
const nodeEnvSaved = process.env.NODE_ENV;
const setNodeEnv = (v: string | undefined) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = v;
};

beforeAll(async () => {
  await prepareDatabase();
  w = await buildWorld();
});
afterAll(async () => {
  setNodeEnv(nodeEnvSaved);
  await closeAll();
});

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const realKey = () => new TextEncoder().encode(process.env.AUTH_JWT_SECRET as string);

async function validDinerToken(): Promise<string> {
  return (await issueSession({ id: w.dinerA, role: 'diner' })).token;
}

const intentBody = () => ({
  transcript: 'Dinner for 2 under 800',
  intent: {
    modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 2,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 1 }],
    client_coordinates: { lat: 12.97, lng: 77.64 },
  },
});

const auctionCount = async () => (await admin.query('SELECT count(*)::int AS n FROM mesh_food_auctions')).rows[0].n;

describe('verifySession rejects forged and tampered tokens', () => {
  test('a garbage cookie value is rejected', async () => {
    expect(await verifySession('not-a-jwt')).toBeNull();
    expect(await verifySession('')).toBeNull();
    expect(await verifySession(null)).toBeNull();
  });

  test('an unsigned token (alg none) is rejected', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: w.dinerB, role: 'diner', exp: Math.floor(Date.now() / 1000) + DAY })}.`;
    expect(await verifySession(token)).toBeNull();
  });

  test('a token signed with another key is rejected', async () => {
    const forged = await new SignJWT({ role: 'diner' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(w.dinerB)
      .setExpirationTime(Math.floor(Date.now() / 1000) + DAY)
      .sign(new TextEncoder().encode('attacker-controlled-signing-key-0000000000'));
    expect(await verifySession(forged)).toBeNull();
  });

  test('a token signed with the right key but a different algorithm (HS512) is rejected', async () => {
    const forged = await new SignJWT({ role: 'diner' })
      .setProtectedHeader({ alg: 'HS512' }).setSubject(w.dinerB)
      .setExpirationTime(Math.floor(Date.now() / 1000) + DAY)
      .sign(realKey());
    expect(await verifySession(forged)).toBeNull();
  });

  test('a valid token with its payload edited to platform_admin (signature kept) is rejected', async () => {
    const [h, , s] = (await validDinerToken()).split('.');
    const edited = b64url({ sub: w.dinerA, role: 'platform_admin', iat: 1, exp: Math.floor(Date.now() / 1000) + DAY });
    expect(await verifySession(`${h}.${edited}.${s}`)).toBeNull();
  });

  test('a token whose subject is swapped to another diner (signature kept) is rejected', async () => {
    const [h, , s] = (await validDinerToken()).split('.');
    const edited = b64url({ sub: w.dinerB, role: 'diner', iat: 1, exp: Math.floor(Date.now() / 1000) + DAY });
    expect(await verifySession(`${h}.${edited}.${s}`)).toBeNull();
  });

  test('an expired token is rejected', async () => {
    const old = await issueSession({ id: w.dinerA, role: 'diner' }, { nowSeconds: Math.floor(Date.now() / 1000) - 31 * DAY });
    expect(await verifySession(old.token)).toBeNull();
  });

  test('a token with a role outside the allowed list is rejected', async () => {
    const token = await new SignJWT({ role: 'superuser' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(w.dinerA)
      .setExpirationTime(Math.floor(Date.now() / 1000) + DAY).sign(realKey());
    expect(await verifySession(token)).toBeNull();
  });

  test('a token without a subject is rejected', async () => {
    const token = await new SignJWT({ role: 'diner' })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) + DAY).sign(realKey());
    expect(await verifySession(token)).toBeNull();
  });

  test('a cookie with a similar but different name is not read as the session', async () => {
    const token = await validDinerToken();
    expect(readSessionToken(`fos_session_old=${token}`)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=${token}`)).toBe(token);
  });
});

describe('routes reject forged or wrong-role sessions before any write', () => {
  test('intent route: forged cookie is 401 and creates no auction', async () => {
    const before = await auctionCount();
    const forged = `${SESSION_COOKIE}=${b64url({ alg: 'none' })}.${b64url({ sub: w.dinerB, role: 'diner' })}.`;
    const res = await intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', intentBody(), { cookie: forged }));
    expect(res.status).toBe(401);
    expect(await auctionCount()).toBe(before);
  });

  test('intent route: a restaurant staff session is refused (diners only)', async () => {
    const before = await auctionCount();
    const res = await intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', intentBody(),
      { cookie: await sessionCookie(w.staffX, 'restaurant_staff') }));
    expect(res.status).toBe(401);
    expect(await auctionCount()).toBe(before);
  });

  test('intent route: a platform_admin session is refused (diners only)', async () => {
    const before = await auctionCount();
    const res = await intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', intentBody(),
      { cookie: await sessionCookie(w.dinerA, 'platform_admin') }));
    expect(res.status).toBe(401);
    expect(await auctionCount()).toBe(before);
  });

  test('ratings route: an expired diner session is 401 and nothing is written', async () => {
    const old = await issueSession({ id: w.dinerA, role: 'diner' }, { nowSeconds: Math.floor(Date.now() / 1000) - 31 * DAY });
    const before = (await admin.query('SELECT count(*)::int AS n FROM verified_customer_ratings')).rows[0].n;
    const res = await ratingsPOST(jsonRequest('http://localhost:3000/api/ratings',
      { order_ref_id: w.dinerAOrderOpen, rating_score: 5 }, { cookie: `${SESSION_COOKIE}=${old.token}` }));
    expect(res.status).toBe(401);
    expect((await admin.query('SELECT count(*)::int AS n FROM verified_customer_ratings')).rows[0].n).toBe(before);
  });

  test('ratings route: no cookie is 401', async () => {
    const res = await ratingsPOST(jsonRequest('http://localhost:3000/api/ratings', { order_ref_id: w.dinerAOrderOpen, rating_score: 5 }));
    expect(res.status).toBe(401);
  });
});

describe('x-dev-diner override', () => {
  test('control: under NODE_ENV=test the override is honoured', async () => {
    setNodeEnv('test');
    const req = new Request('http://localhost:3000/x', { headers: { 'x-dev-diner': w.dinerB } });
    expect(await resolveDiner(req, admin)).toBe(w.dinerB);
  });

  test('under NODE_ENV=production the override is ignored and no cookie means 401', async () => {
    setNodeEnv('production');
    try {
      const req = new Request('http://localhost:3000/x', { headers: { 'x-dev-diner': w.dinerB } });
      await expect(resolveDiner(req, admin)).rejects.toBeInstanceOf(HttpError);
      await expect(resolveDiner(req, admin)).rejects.toMatchObject({ status: 401 });
    } finally {
      setNodeEnv('test');
    }
  });

  test('under NODE_ENV=development the override is ignored', async () => {
    setNodeEnv('development');
    try {
      const req = new Request('http://localhost:3000/x', { headers: { 'x-dev-diner': w.dinerB } });
      await expect(resolveDiner(req, admin)).rejects.toMatchObject({ status: 401 });
    } finally {
      setNodeEnv('test');
    }
  });

  test('intent route under NODE_ENV=production: the override header creates no auction for the named diner', async () => {
    setNodeEnv('production');
    try {
      const before = await auctionCount();
      const res = await intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', intentBody(),
        { 'x-dev-diner': w.dinerB }));
      expect(res.status).toBe(401);
      expect(await auctionCount()).toBe(before);
    } finally {
      setNodeEnv('test');
    }
  });
});
