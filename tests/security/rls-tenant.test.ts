// Check 1: row-level security across tenants, as food_app_login (the runtime identity).
import { getPool } from '@/lib/db/client';
import { prepareDatabase, closeAll, buildWorld, asApp, attempt, denied, adminValue, admin, type World } from './helpers';

let w: World;
beforeAll(async () => {
  await prepareDatabase();
  w = await buildWorld();
});
afterAll(closeAll);

describe('diner A (session for diner A) against diner B', () => {
  test('cannot read diner B auction by id', async () => {
    const rows = await asApp({ userId: w.dinerA }, async (c) =>
      (await c.query('SELECT id FROM mesh_food_auctions WHERE id = $1', [w.dinerBAuction])).rows);
    expect(rows).toHaveLength(0);
  });

  test('cannot update or delete diner B auction', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const upd = await attempt(c, `UPDATE mesh_food_auctions SET status = 'closed' WHERE id = $1`, [w.dinerBAuction]);
      const del = await attempt(c, 'DELETE FROM mesh_food_auctions WHERE id = $1', [w.dinerBAuction]);
      expect(denied(upd)).toBe(true);
      expect(denied(del)).toBe(true);
    });
    expect((await adminValue<{ status: string }>('SELECT status FROM mesh_food_auctions WHERE id = $1', [w.dinerBAuction])).status).toBe('open');
  });

  test('cannot read diner B order_refs', async () => {
    const rows = await asApp({ userId: w.dinerA }, async (c) =>
      (await c.query('SELECT id FROM order_refs WHERE id = $1', [w.dinerBOrderDone])).rows);
    expect(rows).toHaveLength(0);
  });

  test('cannot modify diner B order_refs', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const upd = await attempt(c, `UPDATE order_refs SET status = 'open', settled_at = NULL WHERE id = $1`, [w.dinerBOrderDone]);
      expect(denied(upd)).toBe(true);
    });
    expect((await adminValue<{ status: string }>('SELECT status FROM order_refs WHERE id = $1', [w.dinerBOrderDone])).status).toBe('completed');
  });

  test('cannot read or update diner B tabletop session or its totals', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const read = await c.query('SELECT id FROM tabletop_sessions WHERE id = $1', [w.yDining.sessionId]);
      expect(read.rows).toHaveLength(0);
      const upd = await attempt(c, `UPDATE tabletop_sessions SET total_amount = 0.00 WHERE id = $1`, [w.yDining.sessionId]);
      expect(denied(upd)).toBe(true);
    });
    expect(Number((await adminValue<{ total_amount: string }>('SELECT total_amount FROM tabletop_sessions WHERE id = $1', [w.yDining.sessionId])).total_amount))
      .toBe(0);
  });

  test('cannot modify diner B user row', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const upd = await attempt(c, `UPDATE users SET full_name = 'pwned' WHERE id = $1`, [w.dinerB]);
      expect(denied(upd)).toBe(true);
    });
  });

  test('cannot modify diner B verified rating', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const upd = await attempt(c, 'UPDATE verified_customer_ratings SET rating_score = 1 WHERE id = $1', [w.dinerBRating]);
      const del = await attempt(c, 'DELETE FROM verified_customer_ratings WHERE id = $1', [w.dinerBRating]);
      expect(denied(upd)).toBe(true);
      expect(denied(del)).toBe(true);
    });
  });
});

describe('diner A against their own records (privilege and integrity)', () => {
  test('cannot promote its own user row to staff or platform_admin', async () => {
    await asApp({ userId: w.dinerA }, async (c) => {
      const toStaff = await attempt(c, `UPDATE users SET role = 'restaurant_staff', restaurant_id = $2 WHERE id = $1`, [w.dinerA, w.rY]);
      const toAdmin = await attempt(c, `UPDATE users SET role = 'platform_admin' WHERE id = $1`, [w.dinerA]);
      expect(denied(toStaff)).toBe(true);
      expect(denied(toAdmin)).toBe(true);
    });
    expect((await adminValue<{ role: string }>('SELECT role FROM users WHERE id = $1', [w.dinerA])).role).toBe('diner');
  });

  test('cannot change its own table session totals', async () => {
    await asApp({ userId: w.dinerA, sessionToken: w.xDining.sessionToken }, async (c) => {
      const upd = await attempt(c, 'UPDATE tabletop_sessions SET total_amount = 0.01, subtotal = 0.01 WHERE id = $1', [w.xDining.sessionId]);
      expect(denied(upd)).toBe(true);
    });
  });

  test('cannot change the unit price of its own order lines', async () => {
    const { rows: cat } = await admin.query(
      `INSERT INTO menu_categories (restaurant_id, name, station) VALUES ($1, 'Sec', 'Curry') RETURNING id`, [w.rX]);
    const { rows: item } = await admin.query(
      `INSERT INTO menu_items (restaurant_id, category_id, pos_item_code, name, base_price, dietary)
       VALUES ($1, $2, $3, 'Sec Curry', 450.00, 'pure_veg') RETURNING id`, [w.rX, cat[0].id, `sec-${Date.now()}`]);
    const { rows: line } = await admin.query(
      `INSERT INTO tabletop_order_lines (session_id, restaurant_id, menu_item_id, station, name, unit_price, quantity)
       VALUES ($1, $2, $3, 'Curry', 'Sec Curry', 450.00, 1) RETURNING id`, [w.xDining.sessionId, w.rX, item[0].id]);
    await asApp({ userId: w.dinerA, sessionToken: w.xDining.sessionToken }, async (c) => {
      const upd = await attempt(c, 'UPDATE tabletop_order_lines SET unit_price = 0.01 WHERE id = $1', [line[0].id]);
      expect(denied(upd)).toBe(true);
    });
    expect(Number((await adminValue<{ unit_price: string }>('SELECT unit_price FROM tabletop_order_lines WHERE id = $1', [line[0].id])).unit_price))
      .toBe(450);
  });
});

describe('staff of restaurant X against restaurant Y', () => {
  test('cannot read restaurant Y KDS tickets', async () => {
    const rows = await asApp({ userId: w.staffX }, async (c) =>
      (await c.query('SELECT id FROM kds_tickets WHERE restaurant_id = $1', [w.rY])).rows);
    expect(rows).toHaveLength(0);
  });

  test('cannot bump restaurant Y KDS tickets', async () => {
    await asApp({ userId: w.staffX }, async (c) => {
      const upd = await attempt(c, `UPDATE kds_tickets SET status = 'bumped', bumped_at = NOW() WHERE id = $1`, [w.yTicket]);
      expect(denied(upd)).toBe(true);
    });
    expect((await adminValue<{ status: string }>('SELECT status FROM kds_tickets WHERE id = $1', [w.yTicket])).status).toBe('queued');
  });

  test('cannot update restaurant Y kitchen load', async () => {
    await asApp({ userId: w.staffX }, async (c) => {
      const upd = await attempt(c, 'UPDATE restaurant_nodes SET active_kds_load = 0.00 WHERE id = $1', [w.rY]);
      expect(denied(upd)).toBe(true);
    });
  });

  test('cannot read restaurant Y dining tables', async () => {
    // Owner decision: the runtime role has no column privilege on current_signature_token, so the
    // read is refused with permission denied before RLS filters any row.
    await expect(asApp({ userId: w.staffX }, async (c) =>
      (await c.query('SELECT id, current_signature_token FROM dining_tables WHERE restaurant_id = $1', [w.rY])).rows))
      .rejects.toThrow(/permission denied/);
  });

  test('cannot change restaurant Y dining table signatures', async () => {
    await asApp({ userId: w.staffX }, async (c) => {
      const upd = await attempt(c, `UPDATE dining_tables SET current_signature_token = 'ffffffffffffffffffffffffffffffff' WHERE id = $1`, [w.yDining.tableId]);
      expect(denied(upd)).toBe(true);
    });
  });

  test('cannot read restaurant Y table sessions or order lines', async () => {
    await asApp({ userId: w.staffX }, async (c) => {
      const s = await c.query('SELECT id FROM tabletop_sessions WHERE id = $1', [w.yDining.sessionId]);
      expect(s.rows).toHaveLength(0);
      const l = await c.query('SELECT id FROM tabletop_order_lines WHERE restaurant_id = $1', [w.rY]);
      expect(l.rows).toHaveLength(0);
    });
  });

  test('cannot read or change restaurant Y POS credentials', async () => {
    await asApp({ userId: w.staffX }, async (c) => {
      const read = await attempt(c, 'SELECT ciphertext FROM restaurant_pos_credentials WHERE restaurant_id = $1', [w.rY]);
      const upd = await attempt(c, `UPDATE restaurant_pos_credentials SET ciphertext = '{}' WHERE restaurant_id = $1`, [w.rY]);
      expect(read.error).toMatch(/permission denied/);
      expect(denied(upd)).toBe(true);
    });
  });

  test('cannot obtain restaurant Y POS credential ciphertext through the webhook lookup function', async () => {
    // app_pos_credentials_for_restaurant is SECURITY DEFINER and takes any restaurant id. It must
    // not hand Y's ciphertext to staff of X.
    await asApp({ userId: w.staffX }, async (c) => {
      let ct: unknown = null;
      try {
        ct = (await c.query('SELECT app_pos_credentials_for_restaurant($1) AS ct', [w.rY])).rows[0]?.ct ?? null;
      } catch {
        ct = null; // refused by the database: the expected outcome
      }
      expect(ct).toBeNull();
    });
  });

  test('cannot read restaurant Y counter-bids', async () => {
    const rows = await asApp({ userId: w.staffX }, async (c) =>
      (await c.query('SELECT id FROM auction_counter_bids WHERE restaurant_id = $1', [w.rY])).rows);
    expect(rows).toHaveLength(0);
  });

  test('cannot raise its own rating aggregate', async () => {
    // Ratings are computed by the database trigger from verified reviews. Staff must not write them.
    await asApp({ userId: w.staffX }, async (c) => {
      const upd = await attempt(c, 'UPDATE restaurant_nodes SET rating_aggregate = 5.00, total_verified_reviews = 999 WHERE id = $1', [w.rX]);
      expect(denied(upd)).toBe(true);
    });
    const row = await adminValue<{ rating_aggregate: string }>('SELECT rating_aggregate FROM restaurant_nodes WHERE id = $1', [w.rX]);
    expect(Number(row.rating_aggregate)).toBe(0);
  });

  test('cannot open restaurant Y KDS stream (route level)', async () => {
    const { GET } = await import('@/app/api/ops/[restaurantId]/kds/stream/route');
    const { sessionCookie } = await import('./helpers');
    const req = new Request(`http://localhost:3000/api/ops/${w.rY}/kds/stream`, {
      headers: { cookie: await sessionCookie(w.staffX, 'restaurant_staff') },
    });
    const res = await GET(req, { params: Promise.resolve({ restaurantId: w.rY }) });
    expect(res.status).toBe(403);
    await res.body?.cancel();
  });
});

describe('unauthenticated (no user in session) connection', () => {
  test('cannot read restaurant dining tables or their signatures', async () => {
    // Owner decision: refused with permission denied. The signature token is not readable by the app login.
    await expect(asApp({}, async (c) =>
      (await c.query('SELECT current_signature_token FROM dining_tables WHERE restaurant_id = $1', [w.rY])).rows))
      .rejects.toThrow(/permission denied/);
  });

  test('cannot read kds tickets, auctions or order_refs', async () => {
    await asApp({}, async (c) => {
      expect((await c.query('SELECT id FROM kds_tickets')).rows).toHaveLength(0);
      expect((await c.query('SELECT id FROM mesh_food_auctions')).rows).toHaveLength(0);
      expect((await c.query('SELECT id FROM order_refs')).rows).toHaveLength(0);
    });
  });
});

test('the runtime pool is still the non-superuser login (sanity for this file)', async () => {
  const pool = await getPool();
  const { rows } = await pool.query('SELECT current_user AS u');
  expect(rows[0].u).toBe('food_app_login');
});
