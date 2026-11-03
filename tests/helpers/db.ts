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
