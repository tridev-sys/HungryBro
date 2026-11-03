import { encryptCredentials, loadPosKey } from '../../lib/pos/credentials';
import type pg from 'pg';
import { randomUUID, randomInt } from 'node:crypto';

export const randomPhone = () => '+919' + String(randomInt(100_000_000, 999_999_999));

export async function makeRestaurant(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [`r-${randomUUID()}`, String(randomInt(1e13, 1e14))]);
  return rows[0].id;
}

export async function makeUser(pool: pg.Pool, role = 'diner', restaurantId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id`,
    [randomPhone(), role, restaurantId]);
  return rows[0].id;
}

// Creates a restaurant_nodes row through the owner test pool (not used by app code). Used only by tests.
// pos_credentials is stored encrypted, as in production.
export async function createRestaurant(pool: pg.Pool, opts: { provider: string; credentials: object }): Promise<string> {
  const stored = encryptCredentials(opts.credentials as Record<string, unknown>, loadPosKey());
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, pos_provider, pos_credentials, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', $3, $4, ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [`t-${randomUUID().slice(0, 8)}`, String(Math.floor(1e13 + Math.random() * 9e13)), opts.provider, JSON.stringify(stored)]);
  return rows[0].id;
}
