import type pg from 'pg';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const DEV_DINER_PHONE = '+919000000001';

// Until Plan 05 lands, the only diner is the seeded dev diner, and only when
// ALLOW_DEV_DINER=1. The x-dev-diner header lets tests choose a diner; it is
// honoured only under NODE_ENV=test, even when ALLOW_DEV_DINER=1.
export async function resolveDiner(req: Request, pool: pg.Pool): Promise<string> {
  if (process.env.ALLOW_DEV_DINER !== '1') throw new HttpError(401, 'sign-in required');
  const override = req.headers.get('x-dev-diner');
  if (override && process.env.NODE_ENV === 'test') return override;
  const { rows } = await pool.query('SELECT id FROM users WHERE phone_number = $1', [DEV_DINER_PHONE]);
  if (rows.length === 0) throw new HttpError(401, 'dev diner is not seeded');
  return rows[0].id as string;
}
