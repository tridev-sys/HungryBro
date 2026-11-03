import { getPool } from '@/lib/db/client';
import { readSessionToken, verifySession } from '@/lib/auth/session';
import { SubmitRatingSchema } from '@/lib/ratings/schema';
import { submitVerifiedRating, type RatingRejectCode } from '@/lib/ratings/submit';

const STATUS: Record<RatingRejectCode, number> = {
  ORDER_NOT_FOUND: 404,
  ORDER_NOT_COMPLETED: 409,
  WINDOW_EXPIRED: 422,
  ALREADY_RATED: 409,
};

export async function POST(req: Request): Promise<Response> {
  const claims = await verifySession(readSessionToken(req.headers.get('cookie')));
  if (!claims) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = SubmitRatingSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 });

  const result = await submitVerifiedRating(getPool(), claims.userId, parsed.data);
  if (result.ok) return Response.json({ ratingId: result.ratingId }, { status: 201 });
  return Response.json({ error: result.code }, { status: STATUS[result.code] });
}
