import { useState } from 'react';

export interface BillSplitSelectorProps {
  busy?: boolean;
  onChoose: (strategy: 'EQUAL' | 'BY_CONSUMPTION', contributorCount: number) => void;
  onCancel: () => void;
}

/** Split Equally maps to EQUAL; Itemized maps to BY_CONSUMPTION. */
export function BillSplitSelector({ busy = false, onChoose, onCancel }: BillSplitSelectorProps) {
  const [count, setCount] = useState(2);
  const valid = Number.isInteger(count) && count >= 1 && count <= 20;
  return (
    <section aria-label="Split the bill" className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span>People sharing</span>
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="min-h-[44px] w-20 rounded-md border border-[var(--color-text-muted)] bg-transparent px-2"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!valid || busy} onClick={() => onChoose('EQUAL', count)}
          className="min-h-[44px] rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 font-semibold text-[var(--color-accent-ink)] disabled:opacity-50">
          Split Equally
        </button>
        <button type="button" disabled={!valid || busy} onClick={() => onChoose('BY_CONSUMPTION', count)}
          className="min-h-[44px] rounded-[var(--radius-pill)] border border-[var(--color-text-muted)] px-4 font-semibold disabled:opacity-50">
          Itemized
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-4">Cancel</button>
      </div>
    </section>
  );
}
