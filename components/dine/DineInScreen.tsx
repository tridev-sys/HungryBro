import type { ReactNode } from 'react';
import { AppShell } from '@/components/ui/AppShell';
import { ScreenColumns } from '@/components/ui/ScreenColumns';
import { FilterChip } from '@/components/ui/FilterChip';
import { ActionBar } from '@/components/ui/ActionBar';
import { VoiceOrb, type OrbState } from '@/components/voice/VoiceOrb';
import { TicketCard, type TicketCardProps } from '@/components/kds/TicketCard';
import { TicketStrip } from '@/components/kds/TicketStrip';
import { BillPanel } from '@/components/billing/BillPanel';
import { formatINR } from '@/lib/ui/format';

export interface DineInScreenProps {
  restaurantName: string;
  locality: string;
  orbState: OrbState;
  transcript: string;
  filters: { key: string; label: string; tone?: 'accent' | 'neutral'; pressed: boolean }[];
  tickets: TicketCardProps[];
  bill: { subtotal: number; shareAmount?: number };
  onToggleFilter: (key: string) => void;
  onSplit: () => void;
  onActions: () => void;
  onPay: () => void;
  onCallSteward: () => void;
  /** Optional menu list, rendered above the ticket strip. */
  menu?: ReactNode;
  /** Optional audio level 0..1 for the orb. Defaults to 0. */
  orbLevel?: number;
}

/** Presentational only: Plans 02, 03 and 05 supply the props. */
export function DineInScreen({
  restaurantName,
  locality,
  orbState,
  transcript,
  filters,
  tickets,
  bill,
  onToggleFilter,
  onSplit,
  onActions,
  onPay,
  onCallSteward,
  menu,
  orbLevel,
}: DineInScreenProps) {
  const payLabel =
    bill.shareAmount !== undefined
      ? `PAY MY SHARE VIA DYNAMIC UPI (${formatINR(bill.shareAmount)})`
      : 'PAY';

  const primary = (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-center py-2">
        <VoiceOrb state={orbState} level={orbLevel} />
      </div>
      <p className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed">
        {transcript}
      </p>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            tone={f.tone}
            pressed={f.pressed}
            onToggle={() => onToggleFilter(f.key)}
          />
        ))}
      </div>
      {menu}
      <TicketStrip>
        {tickets.map((t) => (
          <TicketCard key={t.ticketNumber} {...t} />
        ))}
      </TicketStrip>
    </div>
  );

  const secondary = (
    <div className="flex flex-col gap-4 pt-4 pb-4">
      <BillPanel
        subtotal={bill.subtotal}
        shareAmount={bill.shareAmount}
        onSplit={onSplit}
        onActions={onActions}
      />
      <ActionBar
        primaryLabel={payLabel}
        onPrimary={onPay}
        secondaryLabel="CALL STEWARD"
        onSecondary={onCallSteward}
      />
    </div>
  );

  return (
    <AppShell title={restaurantName} subtitle={locality}>
      <ScreenColumns primary={primary} secondary={secondary} />
    </AppShell>
  );
}
