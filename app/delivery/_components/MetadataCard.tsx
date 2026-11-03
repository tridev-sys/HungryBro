import type { ExtractedIntent } from '@/lib/delivery/stub-extract';

export default function MetadataCard({ intent }: { intent: ExtractedIntent }) {
  const coords = intent.client_coordinates;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-[var(--color-surface-2)] p-4 text-sm">
      <dt className="text-[var(--color-text-muted)]">Budget</dt>
      <dd className="text-[var(--color-text)]">{intent.budget_ceiling_inr ? `₹${intent.budget_ceiling_inr}` : 'Not set (₹800 default)'}</dd>
      <dt className="text-[var(--color-text-muted)]">Delivery within</dt>
      <dd className="text-[var(--color-text)]">{intent.sla_max_minutes ? `${intent.sla_max_minutes} min` : 'Not set (30 min default)'}</dd>
      <dt className="text-[var(--color-text-muted)]">Headcount</dt>
      <dd className="text-[var(--color-text)]">{intent.headcount}</dd>
      <dt className="text-[var(--color-text-muted)]">Dietary</dt>
      <dd className="text-[var(--color-text)]">{intent.target_dietary_profiles.join(', ') || 'Any'}</dd>
      <dt className="text-[var(--color-text-muted)]">Items</dt>
      <dd className="text-[var(--color-text)]">
        {intent.items_requested.map((i) => `${i.query} x${i.serving_target}`).join(', ') || 'None'}
      </dd>
      <dt className="text-[var(--color-text-muted)]">Location</dt>
      <dd className="text-[var(--color-text)]">
        {intent.locality ?? 'Unknown'}
        {coords ? ` (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})` : ' (no coordinates)'}
      </dd>
    </dl>
  );
}
