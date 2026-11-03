export interface KitchenLoadBadgeProps {
  /** active_kds_load, 0..1. */
  load: number;
  /** True above 85% (computed by the server from lib/kds/load). */
  backpressure: boolean;
}

export function KitchenLoadBadge({ load, backpressure }: KitchenLoadBadgeProps) {
  const pct = Math.round(load * 100);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3 text-sm tabular-nums">
      <span className="font-semibold">Load: {pct}%</span>
      {backpressure ? (
        <span role="status" className="rounded-[var(--radius-pill)] bg-[var(--color-sla-red)] px-3 py-1 text-xs font-semibold text-white">
          Backpressure: kitchen above 85%
        </span>
      ) : (
        <span className="text-xs text-[var(--color-text-muted)]">Optimal</span>
      )}
    </div>
  );
}
