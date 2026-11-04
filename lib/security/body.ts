// Reads a JSON request body with a byte cap. Rejects oversized bodies before parsing.
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string };

export async function readJsonBody(req: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<JsonBodyResult> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'body too large' };
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'body too large' };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'body must be JSON' };
  }
}
