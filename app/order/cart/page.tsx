import { CartView } from '@/components/order/CartView';

export const dynamic = 'force-dynamic';

export default function CartPage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-text">
      <CartView />
    </main>
  );
}
