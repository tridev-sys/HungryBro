import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Server-only: imported by lib/pos, route handlers, and jobs, never by client components.

export interface EncryptedCredentials {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptCredentials(obj: Record<string, unknown>, key: Buffer): EncryptedCredentials {
  if (key.length !== 32) throw new Error('POS credentials key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function isEncrypted(v: unknown): v is EncryptedCredentials {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.iv === 'string' && typeof o.tag === 'string' && typeof o.ciphertext === 'string';
}

export function decryptCredentials(stored: unknown, key: Buffer): Record<string, unknown> {
  if (typeof stored === 'object' && stored !== null && Object.keys(stored).length === 0) return {};
  if (!isEncrypted(stored)) throw new Error('POS credentials are not in encrypted form');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
}

export function loadPosKey(env: Partial<NodeJS.ProcessEnv> = process.env): Buffer {
  const raw = env.POS_CREDENTIALS_KEY;
  if (!raw) throw new Error('POS_CREDENTIALS_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('POS_CREDENTIALS_KEY must decode to 32 bytes of base64');
  return key;
}
