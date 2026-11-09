import { cookies } from 'next/headers';
import { getPool, asRole } from '@/lib/db/client';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { HomeMenu } from '@/components/home/HomeMenu';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  let name: string | null = null;
  if (claims) {
    name = await asRole(await getPool(), claims.userId, async (c) => {
      const { rows } = await c.query<{ full_name: string | null }>('SELECT full_name FROM users WHERE id = $1', [claims.userId]);
      return rows[0]?.full_name ?? null;
    });
  }
  return <HomeMenu signedIn={claims !== null} name={name} />;
}
