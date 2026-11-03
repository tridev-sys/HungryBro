export interface BidRow {
  restaurantId: string;
  offeredPriceInr: number;
  estimatedPrepMinutes: number;
}

export default function CounterBidList({ bids, names }: { bids: BidRow[]; names: Record<string, string> }) {
  if (bids.length === 0) {
    return <p className="text-sm text-neutral-500">Waiting for kitchens to bid.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm">
      {bids.map((b, i) => (
        <li key={`${b.restaurantId}-${i}`} className="flex items-center justify-between px-4 py-2">
          <span className="text-neutral-900">{names[b.restaurantId] ?? 'Kitchen'}</span>
          <span className="text-neutral-700">
            ₹{b.offeredPriceInr} · {b.estimatedPrepMinutes} min prep
          </span>
        </li>
      ))}
    </ul>
  );
}
