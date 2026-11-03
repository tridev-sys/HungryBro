// Shared fixtures and attacker helpers for the security suite. Test database only.
// Fixtures are inserted through the admin pool (owner-side, as the seeds do). Attacks run through the
// runtime pool as food_app_login, the same identity the app uses. Every attack transaction is rolled
// back, so a successful attack cannot leave data behind for later tests.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin, randomPhone } from '../helpers/db';
import { encryptCredentials, loadPosKey } from '@/lib/pos/credentials';
import { issueSession, SESSION_COOKIE } from '@/lib/auth/session';

if (!process.env.AUTH_JWT_SECRET || process.env.AUTH_JWT_SECRET.length < 32) {
  process.env.AUTH_JWT_SECRET = 'sec-suite-signing-secret-0123456789abcdef';
}

export const admin = getAdminPool();

export async function prepareDatabase(): Promise<void> {
  await runMigrations(admin);
  await ensureAppLogin(admin);
}

export async function closeAll(): Promise<void> {
  const app = await getPool().catch(() => undefined);
  if (app) await app.end();
  await admin.end();
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const GSTIN = '29ABCDE1234F1Z5';

export async function makeRestaurantRow(pool: pg.Pool, lat = 12.97, lng = 77.64): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location, active_kds_load)
     VALUES ($1, $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 0.10) RETURNING id`,
    [`sec-${randomUUID().slice(0, 12)}`, String(Math.floor(1e13 + Math.random() * 9e13)), GSTIN, lng, lat]);
  return rows[0].id;
}

export async function makeUserRow(pool: pg.Pool, role: string, restaurantId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2::user_role, $3) RETURNING id`,
    [randomPhone(), role, restaurantId]);
  return rows[0].id;
}

export interface DiningFixture {
  restaurantId: string;
  tableId: string;
  tableNumber: string;
  signature: string;
  sessionId: string;
  sessionToken: string;
}

export async function makeDiningFixture(pool: pg.Pool, restaurantId: string, dinerId: string | null): Promise<DiningFixture> {
  const tableNumber = `T${hex(3)}`;
  const signature = hex(16);
  const { rows: t } = await pool.query(
    `INSERT INTO dining_tables (restaurant_id, table_number, current_signature_token) VALUES ($1, $2, $3) RETURNING id`,
    [restaurantId, tableNumber, signature]);
  const sessionToken = hex(32);
  const { rows: s } = await pool.query(
    `INSERT INTO tabletop_sessions (table_id, session_token, status, diner_user_id)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [t[0].id, sessionToken, dinerId]);
  return { restaurantId, tableId: t[0].id, tableNumber, signature, sessionId: s[0].id, sessionToken };
}

export async function makeOrder(pool: pg.Pool, o: {
  restaurantId: string; dinerId: string; status: 'open' | 'completed'; settledSecondsAgo?: number | null; sessionId?: string | null;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at, session_id)
     VALUES ($1, $2, $3,
             CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() - ($4::int * INTERVAL '1 second') END,
             $5)
     RETURNING id`,
    [o.restaurantId, o.dinerId, o.status, o.settledSecondsAgo ?? null, o.sessionId ?? null]);
  return rows[0].id;
}

export interface World {
  rX: string; // restaurant X (staff X works here)
  rY: string; // restaurant Y (the victim restaurant)
  dinerA: string; // attacker diner
  dinerB: string; // victim diner
  staffX: string;
  staffY: string;
  dinerAOrderOpen: string;
  dinerBOrderDone: string; // completed at Y, settled an hour ago
  dinerBAuction: string;
  dinerBRating: string;
  yTicket: string;
  yDining: DiningFixture; // table at Y with an active session for diner B
  xDining: DiningFixture; // table at X with an active session for diner A
  yPosSecret: string; // plaintext POS webhook secret for Y (must never leak)
  yPosApiKey: string; // plaintext POS API key for Y (must never leak)
}

export async function buildWorld(): Promise<World> {
  const p = admin;
  const rX = await makeRestaurantRow(p, 12.97, 77.64);
  const rY = await makeRestaurantRow(p, 12.98, 77.65);
  const dinerA = await makeUserRow(p, 'diner');
  const dinerB = await makeUserRow(p, 'diner');
  const staffX = await makeUserRow(p, 'restaurant_staff', rX);
  const staffY = await makeUserRow(p, 'restaurant_staff', rY);

  const dinerAOrderOpen = await makeOrder(p, { restaurantId: rX, dinerId: dinerA, status: 'open' });
  const dinerBOrderDone = await makeOrder(p, { restaurantId: rY, dinerId: dinerB, status: 'completed', settledSecondsAgo: 3600 });

  const { rows: a } = await p.query(
    `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload,
       budget_ceiling_inr, max_sla_minutes, delivery_location)
     VALUES ($1, 'victim auction', '{}', 800, 30, ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)::geography)
     RETURNING id`, [dinerB]);
  const dinerBAuction = a[0].id;

  const { rows: r } = await p.query(
    `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score)
     VALUES ($1, $2, $3, 4) RETURNING id`, [rY, dinerB, dinerBOrderDone]);
  const dinerBRating = r[0].id;

  const { rows: k } = await p.query(
    `INSERT INTO kds_tickets (restaurant_id, order_modality, station, items)
     VALUES ($1, 'DINE_IN', 'Curry', '[]') RETURNING id`, [rY]);
  const yTicket = k[0].id;

  const yDining = await makeDiningFixture(p, rY, dinerB);
  const xDining = await makeDiningFixture(p, rX, dinerA);

  const yPosSecret = `sec-webhook-${hex(12)}`;
  const yPosApiKey = `sec-apikey-${hex(12)}`;
  await p.query(`UPDATE restaurant_nodes SET pos_provider = 'petpooja' WHERE id = $1`, [rY]);
  await p.query(
    `INSERT INTO restaurant_pos_credentials (restaurant_id, pos_provider, ciphertext) VALUES ($1, 'petpooja', $2::jsonb)`,
    [rY, JSON.stringify(encryptCredentials({ webhook_secret: yPosSecret, api_key: yPosApiKey, location_id: 'LOC-Y' }, loadPosKey()))]);

  return {
    rX, rY, dinerA, dinerB, staffX, staffY, dinerAOrderOpen, dinerBOrderDone, dinerBAuction, dinerBRating,
    yTicket, yDining, xDining, yPosSecret, yPosApiKey,
  };
}

export interface Ctx {
  userId?: string | null;
  sessionToken?: string | null;
  tableSignature?: string | null;
}

/**
 * Runs `fn` as the app does: food_app_login -> SET LOCAL ROLE food_app -> session settings.
 * Always rolls back, so attack writes never persist. Use attempt() for statements that may fail.
 */
export async function asApp<T>(ctx: Ctx, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE food_app');
    await c.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.session_token', $2, true),
              set_config('app.table_signature', $3, true)`,
      [ctx.userId ?? '', ctx.sessionToken ?? '', ctx.tableSignature ?? ''],
    );
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

export interface Attempt {
  rowCount: number;
  error: string | null;
}

/** Runs one statement inside a savepoint. Reports rows affected and any database error. */
export async function attempt(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<Attempt> {
  await c.query('SAVEPOINT attempt_sp');
  try {
    const r = await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT attempt_sp');
    return { rowCount: r.rowCount ?? 0, error: null };
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT attempt_sp').catch(() => undefined);
    return { rowCount: 0, error: (err as Error).message };
  }
}

/** True when the database stopped the statement: an error, or zero rows changed. */
export const denied = (a: Attempt) => a.error !== null || a.rowCount === 0;

/** Reads a value through the admin pool (owner view), to confirm a victim row was not changed. */
export async function adminValue<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await admin.query(sql, params);
  return rows[0] as T;
}

export function sessionCookie(userId: string, role: 'diner' | 'restaurant_staff' | 'platform_admin' = 'diner'): Promise<string> {
  return issueSession({ id: userId, role }).then((s) => `${SESSION_COOKIE}=${s.token}`);
}

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
