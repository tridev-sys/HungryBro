// Check 5: input attacks on the public routes and the dine-in table and cart paths.
// Expected: 400 or 422 for malformed or oversized input, never 500, and no data leaking or changing.
import { POST as intentPOST } from '@/app/api/delivery/intent/route';
import { POST as ratingsPOST } from '@/app/api/ratings/route';
import { applyCartUpdate } from '@/lib/dine/cart';
import { openTableSession } from '@/lib/dine/repository';
import { getPool } from '@/lib/db/client';
import { prepareDatabase, closeAll, admin, buildWorld, type World, sessionCookie, jsonRequest } from './helpers';

const SQLI = [
  `' OR '1'='1`,
  `'); DROP TABLE users; --`,
  `1; SELECT pg_sleep(5)--`,
  `" OR ""="`,
  `\\'; DELETE FROM restaurant_nodes; --`,
];

let w: World;
let dinerCookie: string;

beforeAll(async () => {
  await prepareDatabase();
  w = await buildWorld();
  dinerCookie = await sessionCookie(w.dinerA, 'diner');
}, 120_000);
afterAll(closeAll);

const baseIntent = (over: Record<string, unknown> = {}, itemQuery = 'biryani') => ({
  transcript: 'Dinner for 2 under 800',
  intent: {
    modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 2,
    target_dietary_profiles: [], items_requested: [{ query: itemQuery, serving_target: 1 }],
    client_coordinates: { lat: 12.97, lng: 77.64 }, ...over,
  },
});

const intent = (body: unknown, cookie = dinerCookie) =>
  intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', body, { cookie }));

const ratings = (body: unknown, cookie: string) =>
  ratingsPOST(jsonRequest('http://localhost:3000/api/ratings', body, { cookie }));

const countOf = async (table: string) => (await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
// Counts only the users this file created (buildWorld), so inserts by other suites cannot change it.
const ownUserCount = async (): Promise<number> =>
  (await admin.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])', [[w.dinerA, w.dinerB, w.staffX, w.staffY]])).rows[0].n;

describe('POST /api/delivery/intent', () => {
  test.each(SQLI)('SQL injection in the transcript (%s) is stored as text, never executed', async (payload) => {
    const usersBefore = await ownUserCount();
    const body = { ...baseIntent(), transcript: payload };
    let status = 0;
    try {
      status = (await intent(body)).status;
    } catch {
      status = 500;
    }
    expect([201, 400, 422]).toContain(status);
    expect(await ownUserCount()).toBe(usersBefore);
  }, 60_000);

  test.each(SQLI)('SQL injection in an item query (%s) returns no other diner data', async (payload) => {
    const res = await intent(baseIntent({}, payload)).catch(() => null);
    expect(res).not.toBeNull();
    expect([201, 400, 422]).toContain(res!.status);
    const text = await res!.text();
    expect(text).not.toContain(w.dinerB);
    expect(text).not.toMatch(/phone_number|\+91\d{10}/);
  }, 60_000);

  test('a transcript over 500 characters is rejected 400', async () => {
    const res = await intent({ ...baseIntent(), transcript: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  test('an oversized body (about 1.5 MB in one item query) is rejected 400 or 413', async () => {
    const huge = 'biryani '.repeat(190_000); // about 1.5 MB
    const res = await intent(baseIntent({}, huge)).catch(() => null);
    expect(res).not.toBeNull();
    expect([400, 413, 422]).toContain(res!.status);
  }, 120_000);

  test('an absurd budget that overflows NUMERIC(10,2) is rejected 400 or 422, not an unhandled 500', async () => {
    let status = 0;
    try {
      status = (await intent(baseIntent({ budget_ceiling_inr: 1e12 }))).status;
    } catch {
      status = 500;
    }
    expect([400, 422]).toContain(status);
  }, 120_000);

  test('a SLA outside 15 to 120 minutes is rejected 400', async () => {
    expect((await intent(baseIntent({ sla_max_minutes: 1e9 }))).status).toBe(400);
  });

  test('out-of-range and non-numeric coordinates are rejected 400', async () => {
    expect((await intent(baseIntent({ client_coordinates: { lat: 250, lng: 77 } }))).status).toBe(400);
    expect((await intent(baseIntent({ client_coordinates: { lat: 'abc', lng: 77 } }))).status).toBe(400);
  });

  test('malformed JSON, a JSON array and null are rejected 400', async () => {
    expect((await intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', '{"transcript":', { cookie: dinerCookie }))).status).toBe(400);
    expect((await intent([1, 2, 3])).status).toBe(400);
    expect((await intent(null)).status).toBe(400);
  });

  test('a __proto__ key in the body does not pollute Object.prototype', async () => {
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    await intent({ ...baseIntent(), ...polluted }).catch(() => undefined);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, 60_000);
});

describe('POST /api/ratings', () => {
  test.each(SQLI)('SQL injection in order_ref_id (%s) is rejected 400', async (payload) => {
    const res = await ratings({ order_ref_id: payload, rating_score: 5 }, await sessionCookie(w.dinerB, 'diner'));
    expect(res.status).toBe(400);
  });

  test('an operator object in order_ref_id is rejected 400', async () => {
    const res = await ratings({ order_ref_id: { $gt: '' }, rating_score: 5 }, await sessionCookie(w.dinerB, 'diner'));
    expect(res.status).toBe(400);
  });

  test.each([0, 6, '5', 1e9, 4.5])('rating_score %p is rejected 400', async (score) => {
    const res = await ratings({ order_ref_id: w.dinerBOrderDone, rating_score: score }, await sessionCookie(w.dinerB, 'diner'));
    expect(res.status).toBe(400);
  });

  test('feedback over 500 characters is rejected 400', async () => {
    const res = await ratings({ order_ref_id: w.dinerBOrderDone, rating_score: 5, feedback_text: 'a'.repeat(10_000) },
      await sessionCookie(w.dinerB, 'diner'));
    expect(res.status).toBe(400);
  });

  test('an unknown or duplicated review tag is rejected 400', async () => {
    const cookie = await sessionCookie(w.dinerB, 'diner');
    expect((await ratings({ order_ref_id: w.dinerBOrderDone, rating_score: 5, review_tags: ["x'); DROP TABLE users;--"] }, cookie)).status).toBe(400);
    expect((await ratings({ order_ref_id: w.dinerBOrderDone, rating_score: 5, review_tags: ['Fast Prep', 'Fast Prep'] }, cookie)).status).toBe(400);
  });

  test('a 3 MB body is rejected 400', async () => {
    const res = await ratings({ order_ref_id: w.dinerBOrderDone, rating_score: 5, feedback_text: 'z'.repeat(3_000_000) },
      await sessionCookie(w.dinerB, 'diner'));
    expect(res.status).toBe(400);
  });

  test('malformed JSON is rejected 400', async () => {
    const res = await ratingsPOST(jsonRequest('http://localhost:3000/api/ratings', '{"order_ref_id":', {
      cookie: await sessionCookie(w.dinerB, 'diner'),
    }));
    expect(res.status).toBe(400);
  });
});

describe('dine-in table and cart paths', () => {
  test.each(SQLI)('table number injection (%s) cannot open a session', async (payload) => {
    const before = await countOf('tabletop_sessions');
    const err = await openTableSession(await getPool(), {
      restaurantId: w.rY, tableNumber: payload, signature: 'a'.repeat(32), userId: null,
    }).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/TABLE_NOT_FOUND|INVALID_SIGNATURE/);
    expect(await countOf('tabletop_sessions')).toBe(before);
  });

  test('a restaurant id that is not a UUID is refused before any query', async () => {
    const err = await openTableSession(await getPool(), {
      restaurantId: `${w.rY}' OR '1'='1`, tableNumber: w.yDining.tableNumber, signature: 'a'.repeat(32), userId: null,
    }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe('TABLE_NOT_FOUND');
  });

  test('a wrong table signature cannot open a session for a real table', async () => {
    const before = await countOf('tabletop_sessions');
    const err = await openTableSession(await getPool(), {
      restaurantId: w.rY, tableNumber: w.yDining.tableNumber, signature: 'b'.repeat(32), userId: null,
    }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe('INVALID_SIGNATURE');
    expect(await countOf('tabletop_sessions')).toBe(before);
  });

  test('a cart update with an injected session token is refused and writes nothing', async () => {
    const before = await countOf('kds_tickets');
    const body = {
      order_type: 'DINE_IN', action: 'ADD',
      items: [{ item_id: `' OR '1'='1`, name: 'x', station: 'Curry', quantity: 1 }],
    };
    const err = await applyCartUpdate(await getPool(), { sessionToken: `' OR '1'='1`, body }).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/SESSION_NOT_OPEN/);
    expect(await countOf('kds_tickets')).toBe(before);
  });

  test('a cart update with an injected item id is refused and writes nothing', async () => {
    const before = await countOf('kds_tickets');
    const menuBefore = await countOf('menu_items');
    const body = {
      order_type: 'DINE_IN', action: 'ADD',
      items: [{ item_id: `'); DROP TABLE menu_items; --`, name: 'x', station: 'Curry', quantity: 1 }],
    };
    const err = await applyCartUpdate(await getPool(), { sessionToken: w.yDining.sessionToken, body }).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/UNKNOWN_ITEM|invalid input|ZodError|SESSION_NOT_OPEN/i);
    expect(await countOf('kds_tickets')).toBe(before);
    expect(await countOf('menu_items')).toBe(menuBefore);
  }, 60_000);
});
