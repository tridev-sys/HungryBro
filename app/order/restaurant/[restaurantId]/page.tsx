import { notFound } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { loadRestaurantMenu } from '@/lib/delivery-customer/menu';
import { MenuList } from '@/components/order/MenuList';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RestaurantMenuPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  if (!UUID_RE.test(restaurantId)) notFound();
  const menu = await loadRestaurantMenu(await getPool(), restaurantId);
  if (!menu) notFound();
  return (
    <main className="min-h-screen bg-bg px-4 py-6 pb-28 text-text">
      <MenuList restaurantId={menu.restaurant.id} restaurantName={menu.restaurant.name} categories={menu.categories} />
    </main>
  );
}
