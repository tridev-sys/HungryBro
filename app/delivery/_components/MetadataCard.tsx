import type { ExtractedIntent } from '@/lib/delivery/stub-extract';

export default function MetadataCard({ intent }: { intent: ExtractedIntent }) {
  const coords = intent.client_coordinates;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-neutral-200 p-4 text-sm">
      <dt className="text-neutral-500">Budget</dt>
      <dd className="text-neutral-900">{intent.budget_ceiling_inr ? `₹${intent.budget_ceiling_inr}` : 'Not set (₹800 default)'}</dd>
      <dt className="text-neutral-500">Delivery within</dt>
      <dd className="text-neutral-900">{intent.sla_max_minutes ? `${intent.sla_max_minutes} min` : 'Not set (30 min default)'}</dd>
      <dt className="text-neutral-500">Headcount</dt>
      <dd className="text-neutral-900">{intent.headcount}</dd>
      <dt className="text-neutral-500">Dietary</dt>
      <dd className="text-neutral-900">{intent.target_dietary_profiles.join(', ') || 'Any'}</dd>
      <dt className="text-neutral-500">Items</dt>
      <dd className="text-neutral-900">
        {intent.items_requested.map((i) => `${i.query} x${i.serving_target}`).join(', ') || 'None'}
      </dd>
      <dt className="text-neutral-500">Location</dt>
      <dd className="text-neutral-900">
        {intent.locality ?? 'Unknown'}
        {coords ? ` (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})` : ' (no coordinates)'}
      </dd>
    </dl>
  );
}
