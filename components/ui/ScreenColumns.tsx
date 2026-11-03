import type { ReactNode } from 'react';

export interface ScreenColumnsProps {
  primary: ReactNode;
  secondary: ReactNode;
}

export function ScreenColumns({ primary, secondary }: ScreenColumnsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">{primary}</div>
      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">{secondary}</div>
    </div>
  );
}
