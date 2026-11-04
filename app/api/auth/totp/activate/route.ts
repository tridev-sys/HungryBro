import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { activateTotp } from '@/lib/auth/totp';

export const dynamic = 'force-dynamic';

// Activates 2FA with one valid authenticator code. Returns the ten recovery codes once.
export async function POST(req: Request) {
  const pool = await getPool();
  const actor = await resolveActor(pool, req.headers.get('cookie'));
  if (!actor) return NextResponse.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401 });

  let code = '';
  try {
    const body = (await req.json()) as { code?: unknown };
    code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'WRONG_CODE' }, { status: 400 });

  const r = await activateTotp(pool, actor.userId, code);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === 'ALREADY_ENABLED' ? 409 : 400 });
  return NextResponse.json({ recoveryCodes: r.recoveryCodes });
}
