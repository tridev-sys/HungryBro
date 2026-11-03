import type { ReactNode } from 'react';

export interface TicketStripProps {
  children: ReactNode;
  /** Accessible name for the scrolling region. */
  label?: string;
}

/** Horizontal scroll on phones; a wrapping grid on laptops. Focusable so keyboard users can scroll it. */
export function TicketStrip({ children, label = 'Active tickets' }: TicketStripProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="flex snap-x gap-3 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] lg:grid lg:grid-cols-3 lg:overflow-visible"
    >
      {children}
    </div>
  );
}
