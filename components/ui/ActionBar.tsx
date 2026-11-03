export interface ActionBarProps {
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Fixed to the bottom on phones, clear of the iPhone home indicator.
 * Becomes static at the bottom of its column on laptops.
 */
export function ActionBar({
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  secondaryLabel,
  onSecondary,
}: ActionBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] lg:static lg:rounded-[var(--radius-card)]">
      <div className="mx-auto flex max-w-[430px] flex-col gap-2 p-3 lg:max-w-none">
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="h-[52px] w-full rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent-ink)] disabled:opacity-50"
        >
          {primaryLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button
            type="button"
            onClick={onSecondary}
            className="min-h-[44px] w-full rounded-[var(--radius-pill)] border border-[var(--color-text-muted)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-text)]"
          >
            {secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
