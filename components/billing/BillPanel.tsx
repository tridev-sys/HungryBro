import { gstOn, round2 } from '@/lib/pricing';
import { formatINR } from '@/lib/ui/format';

export interface BillPanelProps {
  subtotal: number;
  /** Defaults to 0.05 (5% GST). */
  gstRate?: number;
  /** Per-person share; shown only when provided. */
  shareAmount?: number;
  onSplit: () => void;
  onActions: () => void;
}

export function BillPanel({ subtotal, gstRate = 0.05, shareAmount, onSplit, onActions }: BillPanelProps) {
  const gst = gstOn(subtotal, gstRate);
  const total = round2(subtotal + gst);

  return (
    <section className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 tabular-nums">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Total</span>
        <span className="text-xl font-semibold">{formatINR(total)}</span>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--color-text-muted)]">Subtotal</dt>
          <dd>{formatINR(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--color-text-muted)]">GST ({Math.round(gstRate * 100)}%)</dt>
          <dd>{formatINR(gst)}</dd>
        </div>
        {shareAmount !== undefined ? (
          <div className="flex justify-between">
            <dt className="text-[var(--color-text-muted)]">Your share</dt>
            <dd>{formatINR(shareAmount)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--color-text-muted)]">
          Total: <span className="text-[var(--color-text)]">{formatINR(subtotal)}</span>
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSplit}
            className="min-h-[44px] min-w-[44px] rounded-[var(--radius-pill)] border border-[var(--color-text-muted)] px-4 text-sm font-medium"
          >
            Split
          </button>
          <button
            type="button"
            onClick={onActions}
            className="min-h-[44px] min-w-[44px] rounded-[var(--radius-pill)] bg-[var(--color-surface-2)] px-4 text-sm font-medium"
          >
            Actions
          </button>
        </div>
      </div>
    </section>
  );
}
