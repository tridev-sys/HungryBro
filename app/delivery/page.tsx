import DeliveryConsole from './_components/DeliveryConsole';

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Order delivery</h1>
      <DeliveryConsole />
    </main>
  );
}
