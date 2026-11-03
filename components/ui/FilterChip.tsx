export interface FilterChipProps {
  label: string;
  pressed: boolean;
  tone?: 'accent' | 'neutral';
  onToggle: () => void;
}

export function FilterChip({ label, pressed, tone = 'neutral', onToggle }: FilterChipProps) {
  const base =
    'inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-medium transition-colors';
  const state = pressed
    ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
    : 'bg-[var(--color-surface)] text-[var(--color-text)]';

  return (
    <button type="button" aria-pressed={pressed} onClick={onToggle} className={`${base} ${state}`}>
      {tone === 'accent' ? (
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--color-sla-green)]" />
      ) : null}
      {label}
    </button>
  );
}
