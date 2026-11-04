'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DineInScreen } from '@/components/dine/DineInScreen';
import { MenuList } from '@/components/dine/MenuList';
import { BillSplitSelector } from '@/components/dine/BillSplitSelector';
import { DynamicUpiQrModal, type UpiShare } from '@/components/dine/DynamicUpiQrModal';
import { TableSessionGate } from '@/components/dine/TableSessionGate';
import { RatingModal } from '@/components/ratings/RatingModal';
import type { TicketCardProps } from '@/components/kds/TicketCard';
import { slaColor } from '@/lib/kds/timers';
import type { TicketView } from '@/lib/kds/ticket-view';
import { filterMenu, type FilterState, type MenuCard } from '@/lib/menu/filters';
import { simulatedLevel, SIMULATED_TRANSCRIPT } from '@/lib/voice/simulated';
import type { AllergenTag, SessionStatus } from '@/types/food-os';
import { cartUpdateAction, refreshSettlementAction, requestSplitAction } from '@/app/dine/[restaurantId]/[tableNumber]/actions';

export interface DineSessionView {
  status: SessionStatus;
  subtotal: number;
  total: number;
}

export interface DineSurfaceProps {
  restaurantId: string;
  restaurantName: string;
  ratingLabel: string;
  tableNumber: string;
  signature: string | null;
  session: DineSessionView | null;
  tickets: TicketView[];
  menu: MenuCard[];
  /** A completed order of this session the signed-in diner can rate, or null (no prompt). */
  ratingOrderRefId: string | null;
}

const ALLERGENS: AllergenTag[] = ['peanut', 'shellfish', 'dairy', 'gluten'];

/**
 * How often the diner checks payment while the bill is pending. The rating window is 2 s from the
 * server-recorded settled_at, so a stale check must not cost the diner the prompt. The stream
 * (session.settled) gives the instant update; this poll is what asks the payment provider.
 */
export const SETTLEMENT_POLL_MS = 1000;

const NO_FILTERS: FilterState = { pureVeg: false, jain: false, halal: false, mildSpicy: false };

function toCard(t: TicketView, nowMs: number | null): TicketCardProps {
  const elapsed = nowMs === null ? 0 : (nowMs - Date.parse(t.firedAt)) / 60_000;
  return {
    ticketNumber: t.ticketNumber,
    station: t.station,
    status: t.status,
    elapsedMinutes: elapsed,
    orderOrigin: 'DINE_IN',
    items: t.items.map((i) => `${i.quantity}x ${i.name}`),
    colour: nowMs === null ? undefined : slaColor(elapsed, 'DINE_IN'),
  };
}

export function DineSurface(props: DineSurfaceProps) {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [exclusions, setExclusions] = useState<AllergenTag[]>([]);
  const [tickets, setTickets] = useState<TicketView[]>(props.tickets);
  const [shares, setShares] = useState<UpiShare[] | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [line, setLine] = useState(0);
  const [ratingOpen, setRatingOpen] = useState(true);
  const sessionOpen = props.session !== null && props.session.status === 'active';
  const paying = props.session?.status === 'payment_pending';

  // Client-only clocks: the first render has no time, so server and client markup match.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      setLevel(simulatedLevel(now, true));
    };
    tick();
    const id = setInterval(tick, 500);
    const lines = setInterval(() => setLine((n) => (n + 1) % SIMULATED_TRANSCRIPT.length), 3000);
    return () => { clearInterval(id); clearInterval(lines); };
  }, []);

  // Live ticket updates and settlement for this table's session.
  const hasSession = props.session !== null;
  useEffect(() => {
    if (!hasSession) return;
    const source = new EventSource('/api/dine/stream');
    source.onmessage = (msg: MessageEvent<string>) => {
      const event = JSON.parse(msg.data) as { type?: string; ticket?: TicketView };
      if (event.type === 'session.settled') {
        // The server re-renders with the closed session and the ratable order, so the prompt
        // opens from the same fetch rather than waiting for the next poll tick.
        router.refresh();
        return;
      }
      if (!event.ticket) return;
      const ticket = event.ticket;
      setTickets((prev) => {
        const rest = prev.filter((t) => t.id !== ticket.id);
        return ticket.status === 'served' ? rest : [...rest, ticket].sort((a, b) => a.firedAt.localeCompare(b.firedAt));
      });
    };
    return () => source.close();
  }, [hasSession, router]);

  // While payment is pending, check the settlement until every share is paid.
  useEffect(() => {
    if (!paying) return;
    const id = setInterval(async () => {
      try {
        const r = await refreshSettlementAction();
        if (r.status === 'closed') router.refresh();
      } catch {
        /* keep polling; a transient failure is not an error for the diner */
      }
    }, SETTLEMENT_POLL_MS);
    return () => clearInterval(id);
  }, [paying, router]);

  const visibleMenu = useMemo(() => filterMenu(props.menu, filters, exclusions), [props.menu, filters, exclusions]);
  const cards = useMemo(() => tickets.map((t) => toCard(t, nowMs)), [tickets, nowMs]);

  if (!props.session || props.session.status === 'abandoned') {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <header className="p-4">
          <h1 className="text-sm font-semibold tracking-wide">{props.restaurantName}</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Table {props.tableNumber} · {props.ratingLabel}</p>
        </header>
        <TableSessionGate restaurantId={props.restaurantId} tableNumber={props.tableNumber} signature={props.signature} />
      </main>
    );
  }

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleFilter = (key: string) => {
    if (key.startsWith('no-')) {
      const tag = key.slice(3) as AllergenTag;
      setExclusions((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
      return;
    }
    setFilters((cur) => ({ ...cur, [key]: !cur[key as keyof FilterState] }));
  };

  const filterChips = [
    { key: 'pureVeg', label: 'Pure Veg', pressed: filters.pureVeg, tone: 'accent' as const },
    { key: 'jain', label: 'Jain', pressed: filters.jain },
    { key: 'halal', label: 'Halal', pressed: filters.halal },
    { key: 'mildSpicy', label: 'Mild Spicy', pressed: filters.mildSpicy },
    ...ALLERGENS.map((a) => ({ key: `no-${a}`, label: `No ${a}`, pressed: exclusions.includes(a) })),
  ];

  const addItem = (item: MenuCard) =>
    run(() => cartUpdateAction({
      order_type: 'DINE_IN',
      action: 'ADD',
      items: [{ item_id: item.id, name: item.name, quantity: 1 }],
    }));

  const onSplitChosen = (strategy: 'EQUAL' | 'BY_CONSUMPTION', contributorCount: number) =>
    run(async () => {
      const r = await requestSplitAction({ strategy, contributorCount });
      setShares(r.shares.map((s) => ({ index: s.index, amount: s.amount, upiUri: s.upiUri })));
      setQrOpen(true);
      setShowSplit(false);
    });

  const splitPanel = showSplit ? (
    <BillSplitSelector busy={busy} onChoose={onSplitChosen} onCancel={() => setShowSplit(false)} />
  ) : null;

  const menuPanel = (
    <div className="space-y-3">
      {sessionOpen ? (
        <MenuList items={visibleMenu} onAdd={addItem} busy={busy} />
      ) : (
        <p className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-sm">
          Ordering is closed while the bill is being paid.
        </p>
      )}
      {splitPanel}
      {notice ? <p role="status" className="text-sm text-[var(--color-text)]">{notice}</p> : null}
    </div>
  );

  const bill = {
    subtotal: props.session.subtotal,
    shareAmount: shares && shares.length === 1 ? shares[0].amount : undefined,
  };

  return (
    <>
      <DineInScreen
        restaurantName={props.restaurantName}
        locality={`Table ${props.tableNumber} · ${props.ratingLabel}`}
        orbState={level > 0 ? 'listening' : 'idle'}
        orbLevel={level}
        transcript={SIMULATED_TRANSCRIPT[line].text}
        filters={filterChips}
        tickets={cards}
        bill={bill}
        onToggleFilter={toggleFilter}
        onSplit={() => setShowSplit(true)}
        onActions={() => router.refresh()}
        onPay={() => (shares ? setQrOpen(true) : setShowSplit(true))}
        onCallSteward={() => setNotice('Steward calls are not connected in this build.')}
        menu={menuPanel}
      />
      {shares && qrOpen ? <DynamicUpiQrModal shares={shares} onClose={() => setQrOpen(false)} /> : null}
      {props.ratingOrderRefId && ratingOpen ? (
        <RatingModal
          orderRefId={props.ratingOrderRefId}
          restaurantName={props.restaurantName}
          onClose={() => setRatingOpen(false)}
        />
      ) : null}
    </>
  );
}
