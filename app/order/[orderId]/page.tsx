import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { getOrderStatus } from '@/lib/delivery-customer/order-status';
import { OrderStatus } from '@/components/order/OrderStatus';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderStatusPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID_RE.test(orderId)) notFound();
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  if (!claims || claims.role !== 'diner') redirect('/auth/login');
  const view = await getOrderStatus(await getPool(), claims.userId, orderId);
  if (!view) notFound();
  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-text">
      <OrderStatus initial={view} />
    </main>
  );
}
