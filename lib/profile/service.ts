import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { isValidVpa, isValidGstin } from '@/lib/compliance/validators';

// Every function runs inside asRole(pool, userId, ...), so RLS limits rows to the caller.
// Errors from the database are caught outside asRole: asRole rolls back the whole transaction on a throw.

export type ProfileFormState = { message?: string; error?: string };

export async function listVpas(pool: pg.Pool, userId: string): Promise<string[]> {
  return asRole(pool, userId, async (c) => {
    const { rows } = await c.query<{ vpa: string }>('SELECT vpa FROM user_vpas ORDER BY created_at, vpa');
    return rows.map((r) => r.vpa);
  });
}

export async function addVpa(
  pool: pg.Pool,
  userId: string,
  raw: string,
): Promise<{ ok: true; vpa: string } | { ok: false; reason: 'INVALID_VPA' | 'DUPLICATE' }> {
  const vpa = raw.trim();
  if (!isValidVpa(vpa)) return { ok: false, reason: 'INVALID_VPA' };
  try {
    await asRole(pool, userId, (c) =>
      c.query('INSERT INTO user_vpas (user_id, vpa) VALUES ($1, $2)', [userId, vpa]));
    return { ok: true, vpa };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return { ok: false, reason: 'DUPLICATE' };
    throw err;
  }
}

export async function removeVpa(
  pool: pg.Pool,
  userId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }> {
  const vpa = raw.trim();
  return asRole(pool, userId, async (c) => {
    const { rowCount } = await c.query('DELETE FROM user_vpas WHERE user_id = $1 AND vpa = $2', [userId, vpa]);
    if (!rowCount) return { ok: false as const, reason: 'NOT_FOUND' as const };
    await c.query(
      'UPDATE users SET default_vpa = NULL, updated_at = NOW() WHERE id = $1 AND default_vpa = $2',
      [userId, vpa]);
    return { ok: true as const };
  });
}

export async function setDefaultVpa(
  pool: pg.Pool,
  userId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }> {
  const vpa = raw.trim();
  return asRole(pool, userId, async (c) => {
    const { rowCount } = await c.query('SELECT 1 FROM user_vpas WHERE user_id = $1 AND vpa = $2', [userId, vpa]);
    if (!rowCount) return { ok: false as const, reason: 'NOT_FOUND' as const };
    await c.query('UPDATE users SET default_vpa = $2, updated_at = NOW() WHERE id = $1', [userId, vpa]);
    return { ok: true as const };
  });
}

export async function saveGstin(
  pool: pg.Pool,
  userId: string,
  raw: string,
): Promise<{ ok: true; gstin: string | null } | { ok: false; reason: 'INVALID_GSTIN' }> {
  const trimmed = raw.trim();
  const value = trimmed === '' ? null : trimmed.toUpperCase();
  if (value !== null && !isValidGstin(value)) return { ok: false, reason: 'INVALID_GSTIN' };
  await asRole(pool, userId, (c) =>
    c.query('UPDATE users SET saved_gstin = $2, updated_at = NOW() WHERE id = $1', [userId, value]));
  return { ok: true, gstin: value };
}

export async function getProfile(
  pool: pg.Pool,
  userId: string,
): Promise<{ vpas: string[]; defaultVpa: string | null; savedGstin: string | null; email: string | null }> {
  return asRole(pool, userId, async (c) => {
    const vpas = await c.query<{ vpa: string }>('SELECT vpa FROM user_vpas ORDER BY created_at, vpa');
    const me = await c.query<{ default_vpa: string | null; saved_gstin: string | null; email: string | null }>(
      'SELECT default_vpa, saved_gstin, email FROM users WHERE id = $1', [userId]);
    return {
      vpas: vpas.rows.map((r) => r.vpa),
      defaultVpa: me.rows[0]?.default_vpa ?? null,
      savedGstin: me.rows[0]?.saved_gstin ?? null,
      email: me.rows[0]?.email ?? null,
    };
  });
}
