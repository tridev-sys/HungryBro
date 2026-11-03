'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openTableSessionAction } from '@/app/dine/[restaurantId]/[tableNumber]/actions';

export interface TableSessionGateProps {
  restaurantId: string;
  tableNumber: string;
  signature: string | null;
}

/** Opens (or reuses) the table session from the QR signature, then reloads the page. */
export function TableSessionGate({ restaurantId, tableNumber, signature }: TableSessionGateProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    openTableSessionAction({ restaurantId, tableNumber, signature })
      .then(() => { if (!cancelled) router.refresh(); })
      .catch(() => { if (!cancelled) setError('This table code is not valid. Ask staff for help.'); });
    return () => { cancelled = true; };
  }, [restaurantId, tableNumber, signature, router]);

  if (!signature) {
    return <p className="p-4 text-sm">Scan the QR code on your table to start your order.</p>;
  }
  if (error) return <p role="alert" className="p-4 text-sm">{error}</p>;
  return <p className="p-4 text-sm text-[var(--color-text-muted)]">Opening your table…</p>;
}
