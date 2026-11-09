import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { SESSION_COOKIE } from '@/lib/auth/session';

// Clears the signed session cookie (same name and flags as sign-in) and returns to the home page.
// Works whether or not a session exists, so a double submit is harmless.
async function handlePost(_req: Request): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
