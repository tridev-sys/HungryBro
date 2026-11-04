import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { beginEnrolment } from '@/lib/auth/totp';

export const dynamic = 'force-dynamic';

// Starts 2FA enrolment for the signed-in user. Returns the otpauth URI and a QR code (PNG data URL).
// 2FA is not enabled until POST /api/auth/totp/activate succeeds with a valid code.
export async function POST(req: Request) {
  const pool = await getPool();
  const actor = await resolveActor(pool, req.headers.get('cookie'));
  if (!actor) return NextResponse.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401 });

  const r = await beginEnrolment(pool, actor.userId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ otpauthUri: r.otpauthUri, qrDataUrl: r.qrDataUrl });
}
