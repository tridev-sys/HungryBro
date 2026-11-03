import type { ReactNode } from 'react';
import { Menu, MoreVertical } from 'lucide-react';

export interface AppShellProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, right, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="sticky top-0 z-10 bg-[var(--color-surface)] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-[430px] items-center gap-3 px-4 py-3 lg:max-w-none">
          <button
            type="button"
            aria-label="Open menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[var(--color-surface-2)]"
          >
            <Menu aria-hidden="true" size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-wide">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">
            {right ?? (
              <button
                type="button"
                aria-label="More options"
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--color-surface-2)]"
              >
                <MoreVertical aria-hidden="true" size={22} />
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[430px] px-4 pb-28 lg:max-w-none lg:px-6 lg:pb-4">{children}</main>
    </div>
  );
}
