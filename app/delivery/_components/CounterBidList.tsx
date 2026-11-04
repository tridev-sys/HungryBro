export interface BidRow {
  restaurantId: string;
  offeredPriceInr: number;
  estimatedPrepMinutes: number;
}

export default function CounterBidList({ bids, names }: { bids: BidRow[]; names: Record<string, string> }) {
  if (bids.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Waiting for kitchens to bid.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--color-surface-2)] rounded-md border border-[var(--color-surface-2)] text-sm">
      {bids.map((b, i) => (
        <li key={`${b.restaurantId}-${i}`} className="flex items-center justify-between px-4 py-2">
          <span className="text-[var(--color-text)]">{names[b.restaurantId] ?? 'Kitchen'}</span>
          <span className="text-[var(--color-text)]">
            ₹{b.offeredPriceInr} · {b.estimatedPrepMinutes} min prep
          </span>
        </li>
      ))}
    </ul>
  );
}
