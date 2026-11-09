import Link from 'next/link';

export default function DineInPage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-10 text-text">
      <h1 className="text-2xl font-semibold">Dine in</h1>
      <p className="mt-4 text-text-muted">Scan the QR code on your table to see the menu and order.</p>
      <Link href="/" className="mt-6 inline-block text-accent">Back to home</Link>
    </main>
  );
}
