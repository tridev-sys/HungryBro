import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { loadBoard } from '@/lib/kds/board';
import { AppShell } from '@/components/ui/AppShell';
import { KdsBoard } from '@/components/kds/KdsBoard';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ['restaurant_staff', 'kitchen_lead'];

function Message({ children }: { children: string }) {
  return <p className="p-6 text-sm">{children}</p>;
}

export default async function KdsPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  if (!UUID_RE.test(restaurantId)) notFound();
  const pool = getPool();
  const actor = await resolveActor(pool, (await cookies()).toString());
  if (!actor) return <Message>Sign in required.</Message>;
  if (actor.restaurantId !== restaurantId || !STAFF_ROLES.includes(actor.role)) {
    return <Message>403: this kitchen belongs to another restaurant or you do not have kitchen access.</Message>;
  }

  const name = await pool.query<{ name: string }>('SELECT name FROM restaurant_nodes WHERE id = $1', [restaurantId]);
  if (!name.rows[0]) notFound();
  const board = await loadBoard(pool, actor, restaurantId);

  return (
    <AppShell title={`${name.rows[0].name} · Kitchen`} subtitle="Route 3 KDS">
      <KdsBoard
        restaurantId={restaurantId}
        initialTickets={board.tickets}
        initialLoad={board.load}
        initialBackpressure={board.backpressure}
      />
    </AppShell>
  );
}
