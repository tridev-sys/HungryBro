/** 64 KiB. Applies to every /api/* route handler. */
export const BODY_LIMIT_BYTES = 65536;

export class PayloadTooLargeError extends Error {
  constructor(public readonly limit: number = BODY_LIMIT_BYTES) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/** Fast path: refuses a declared Content-Length above the limit before reading the body. */
export function enforceDeclaredLength(h: Headers, limit: number = BODY_LIMIT_BYTES): void {
  const raw = h.get('content-length');
  if (raw === null) return;
  const n = Number(raw);
  if (Number.isFinite(n) && n > limit) throw new PayloadTooLargeError(limit);
}

/**
 * Reads the body while counting bytes, so a chunked body with no Content-Length is also capped.
 * Throws PayloadTooLargeError once the count passes `limit`.
 */
export async function readJsonWithLimit(req: Request, limit: number = BODY_LIMIT_BYTES): Promise<unknown> {
  enforceDeclaredLength(req.headers, limit);
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PayloadTooLargeError(limit);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}
