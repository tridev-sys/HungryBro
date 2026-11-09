import { CheckoutView } from '@/components/order/CheckoutView';

export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-text">
      <CheckoutView />
    </main>
  );
}
