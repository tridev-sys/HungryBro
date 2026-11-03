import type pg from 'pg';
import { readSessionToken, verifySession } from '@/lib/auth/session';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const DEV_DINER_PHONE = '+919000000001';

// Plan 05 is merged, so the diner comes from the real signed session cookie.
// The x-dev-diner header is a test-only override, honoured only under NODE_ENV=test.
export async function resolveDiner(req: Request, _pool: pg.Pool): Promise<string> {
  const override = req.headers.get('x-dev-diner');
  if (override && process.env.NODE_ENV === 'test') return override;
  const claims = await verifySession(readSessionToken(req.headers.get('cookie')));
  if (!claims || claims.role !== 'diner') throw new HttpError(401, 'sign-in required');
  // The token is signed by this server and verified above. The row-level policy on
  // users hides other users from this connection, so no extra lookup is made here.
  return claims.userId;
}
