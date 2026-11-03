import type { ReactNode } from 'react';

export interface TicketStripProps {
  children: ReactNode;
}

/** Horizontal scroll on phones; a wrapping grid on laptops. */
export function TicketStrip({ children }: TicketStripProps) {
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible">
      {children}
    </div>
  );
}
