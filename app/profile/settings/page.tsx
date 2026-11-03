import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { getProfile } from '@/lib/profile/service';
import { SettingsForms } from './SettingsForms';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) redirect('/auth/login');
  const profile = await getProfile(await getPool(), claims.userId);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Profile settings</h1>
      <SettingsForms profile={profile} />
    </main>
  );
}
