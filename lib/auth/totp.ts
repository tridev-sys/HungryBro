import { createHmac, randomInt } from 'node:crypto';
import type pg from 'pg';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { asRole } from '@/lib/db/client';
import { decryptCredentials, encryptCredentials } from '@/lib/pos/credentials';

// Server-only: the secret and the recovery-code key never reach the client.
// RFC 6238 TOTP, SHA-1, 6 digits, 30-second step (the defaults that authenticator apps expect).
// The otpauth library (MIT, pure JavaScript) does the arithmetic.

export const RECOVERY_CODE_COUNT = 10;
const ISSUER = 'Food OS';
const ALGORITHM = 'SHA1';
const DIGITS = 6;
const PERIOD = 30;
// Ambiguous characters (0, O, 1, I) are left out so codes can be read off paper.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** TOTP_ENCRYPTION_KEY: 32 random bytes, base64. Same format as POS_CREDENTIALS_KEY. */
export function loadTotpKey(env: Partial<NodeJS.ProcessEnv> = process.env): Buffer {
  const raw = env.TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOTP_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must decode to 32 bytes of base64');
  return key;
}

export async function isTotpEnabled(pool: pg.Pool, userId: string): Promise<boolean> {
  return asRole(pool, userId, async (c) => {
    const { rows } = await c.query('SELECT 1 FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL', [userId]);
    return rows.length > 0;
  });
}

export type EnrolmentResult =
  | { ok: true; otpauthUri: string; qrDataUrl: string }
  | { ok: false; reason: 'ALREADY_ENABLED' };

/**
 * Starts enrolment: creates a new secret (replacing any pending one), stores it encrypted, and
 * returns the otpauth URI and a PNG QR code. 2FA stays off until activateTotp succeeds.
 */
export async function beginEnrolment(
  pool: pg.Pool,
  userId: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<EnrolmentResult> {
  const key = loadTotpKey(env);
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: 'Food OS account',
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  const otpauthUri = totp.toString();
  const stored = encryptCredentials({ secret: secret.base32 }, key);

  const outcome = await asRole(pool, userId, async (c) => {
    const { rows } = await c.query<{ enabled_at: Date | null }>(
      'SELECT enabled_at FROM user_totp WHERE user_id = $1 FOR UPDATE', [userId]);
    if (rows[0]?.enabled_at) return 'ALREADY_ENABLED' as const;
    await c.query(
      `INSERT INTO user_totp (user_id, secret_encrypted) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_encrypted = EXCLUDED.secret_encrypted, last_used_step = NULL, updated_at = NOW()`,
      [userId, JSON.stringify(stored)]);
    return 'OK' as const;
  });
  if (outcome === 'ALREADY_ENABLED') return { ok: false, reason: 'ALREADY_ENABLED' };

  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return { ok: true, otpauthUri, qrDataUrl };
}

export type ActivationResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'NO_PENDING_ENROLMENT' | 'ALREADY_ENABLED' | 'WRONG_CODE' };

/**
 * Activates 2FA when the user proves one valid code. Issues the recovery codes; they are shown once
 * and only their HMAC digests are stored.
 */
export async function activateTotp(
  pool: pg.Pool,
  userId: string,
  code: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<ActivationResult> {
  const key = loadTotpKey(env);
  return asRole(pool, userId, async (c) => {
    const { rows } = await c.query<{ secret_encrypted: unknown; enabled_at: Date | null; last_used_step: string | null }>(
      'SELECT secret_encrypted, enabled_at, last_used_step FROM user_totp WHERE user_id = $1 FOR UPDATE', [userId]);
    const row = rows[0];
    if (!row) return { ok: false, reason: 'NO_PENDING_ENROLMENT' };
    if (row.enabled_at) return { ok: false, reason: 'ALREADY_ENABLED' };

    const secret = readSecret(row.secret_encrypted, key);
    const step = matchStep(secret, code, toStep(row.last_used_step));
    if (step === null) return { ok: false, reason: 'WRONG_CODE' };

    await c.query(
      'UPDATE user_totp SET enabled_at = NOW(), last_used_step = $2, updated_at = NOW() WHERE user_id = $1',
      [userId, step]);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode());
    for (const rc of recoveryCodes) {
      await c.query(
        'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
        [userId, recoveryDigest(key, rc)]);
    }
    return { ok: true, recoveryCodes };
  });
}

export type SecondFactorResult = { ok: true; method: 'totp' | 'recovery' } | { ok: false; reason: 'WRONG_CODE' };

/**
 * Checks the second factor at sign-in. Six digits are a TOTP code (one step either side, and a
 * code can be used once). Anything else is a recovery code (single use, case and dash ignored).
 */
export async function verifySecondFactor(
  pool: pg.Pool,
  userId: string,
  input: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<SecondFactorResult> {
  const key = loadTotpKey(env);
  const normalized = normaliseRecovery(input);

  if (/^\d{6}$/.test(normalized)) {
    const ok = await asRole(pool, userId, async (c) => {
      const { rows } = await c.query<{ secret_encrypted: unknown; last_used_step: string | null }>(
        'SELECT secret_encrypted, last_used_step FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL FOR UPDATE',
        [userId]);
      const row = rows[0];
      if (!row) return false;
      const step = matchStep(readSecret(row.secret_encrypted, key), normalized, toStep(row.last_used_step));
      if (step === null) return false;
      await c.query('UPDATE user_totp SET last_used_step = $2, updated_at = NOW() WHERE user_id = $1', [userId, step]);
      return true;
    });
    return ok ? { ok: true, method: 'totp' } : { ok: false, reason: 'WRONG_CODE' };
  }

  const spent = await asRole(pool, userId, async (c) => {
    const { rows } = await c.query(
      `UPDATE totp_recovery_codes SET used_at = NOW()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [userId, recoveryDigest(key, normalized)]);
    return rows.length > 0;
  });
  return spent ? { ok: true, method: 'recovery' } : { ok: false, reason: 'WRONG_CODE' };
}

// ---- helpers (no I/O) ----

function readSecret(stored: unknown, key: Buffer): string {
  const { secret } = decryptCredentials(stored, key);
  if (typeof secret !== 'string') throw new Error('TOTP secret is malformed');
  return secret;
}

function toStep(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/** Returns the accepted 30-second counter, or null when the code is wrong or was already used. */
export function matchStep(base32Secret: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const totp = new OTPAuth.TOTP({
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return null;
  const counter = Math.floor(now / 1000 / PERIOD) + delta;
  if (lastUsedStep !== null && counter <= lastUsedStep) return null;
  return counter;
}

function newRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normaliseRecovery(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

function recoveryDigest(key: Buffer, code: string): string {
  return createHmac('sha256', key).update(`recovery:${normaliseRecovery(code)}`).digest('hex');
}
