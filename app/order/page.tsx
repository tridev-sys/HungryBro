import Link from 'next/link';
import { getPool } from '@/lib/db/client';
import { listDeliveryRestaurants } from '@/lib/delivery-customer/restaurants';

export const dynamic = 'force-dynamic';

export default async function OrderPage() {
  const restaurants = await listDeliveryRestaurants(await getPool());
  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-text">
      <h1 className="text-2xl font-semibold">Order delivery</h1>
      {restaurants.length === 0 ? (
        <p className="mt-6 text-text-muted">No restaurants are delivering right now.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {restaurants.map((r) => (
            <li key={r.id}>
              <Link
                href={`/order/restaurant/${r.id}`}
                className="block rounded-card bg-surface p-4 hover:bg-surface-2"
              >
                <span className="block text-lg font-medium">{r.name}</span>
                <span className="block text-sm text-text-muted">{r.ratingText}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
