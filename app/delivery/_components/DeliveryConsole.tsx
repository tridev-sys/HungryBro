'use client';

import { useEffect, useState } from 'react';
import VoiceInput from './VoiceInput';
import MetadataCard from './MetadataCard';
import CounterBidList, { type BidRow } from './CounterBidList';
import DispatchPanel, { type DispatchInfo } from './DispatchPanel';
import { extractIntentStub, type ExtractedIntent } from '@/lib/delivery/stub-extract';

interface Bundle {
  restaurantId: string;
  name: string;
  offeredPriceInr: number;
  estimatedPrepMinutes: number;
}

interface AuctionView {
  id: string;
  windowClosesAt: string;
  offsetMs: number; // server clock minus client clock, from the response Date header
  status: string;
  bids: BidRow[];
  bundles: Bundle[];
  dispatch?: DispatchInfo;
  error?: string;
}

export default function DeliveryConsole() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedIntent | null>(null);
  const [auction, setAuction] = useState<AuctionView | null>(null);
  const [now, setNow] = useState(0);

  // Live updates over SSE for the open auction.
  useEffect(() => {
    if (!auction) return;
    const es = new EventSource(`/api/delivery/auctions/${auction.id}/events`);
    const patch = (fn: (a: AuctionView) => AuctionView) => setAuction((prev) => (prev ? fn(prev) : prev));

    es.addEventListener('snapshot', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch((a) => ({ ...a, status: d.status, windowClosesAt: d.windowClosesAt, bids: d.bids }));
    });
    es.addEventListener('bid', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as BidRow;
      patch((a) => ({ ...a, bids: [...a.bids, d] }));
    });
    es.addEventListener('status', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch((a) => ({ ...a, status: d.status, windowClosesAt: d.windowClosesAt }));
    });
    es.addEventListener('dispatch', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as DispatchInfo;
      patch((a) => ({ ...a, dispatch: d }));
      es.close();
    });
    es.addEventListener('error', (e) => {
      if ('data' in e) {
        const d = JSON.parse((e as MessageEvent).data);
        patch((a) => ({ ...a, error: d.message }));
      }
      es.close();
    });
    return () => es.close();
  }, [auction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown ticks against the server-corrected clock.
  const windowOpen = auction !== null && auction.status === 'open';
  useEffect(() => {
    if (!windowOpen) return;
    const tick = () => setNow(Date.now() + (auction?.offsetMs ?? 0));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [windowOpen, auction?.offsetMs]);

  async function submit() {
    setError(null);
    const parsed = extractIntentStub(text);
    setExtracted(parsed);
    if (!parsed.client_coordinates) {
      setError('Pick a pilot locality (Indiranagar or HSR).');
      return;
    }
    if (parsed.items_requested.length === 0) {
      setError('Name at least one item.');
      return;
    }
    const intent = {
      modality: 'DELIVERY',
      budget_ceiling_inr: parsed.budget_ceiling_inr ?? 800,
      sla_max_minutes: parsed.sla_max_minutes ?? 30,
      headcount: parsed.headcount,
      target_dietary_profiles: [],
      items_requested: parsed.items_requested,
      client_coordinates: parsed.client_coordinates,
    };
    setBusy(true);
    setAuction(null);
    try {
      const res = await fetch('/api/delivery/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: text, intent }),
      });
      const json = await res.json();
      if (res.status !== 201) {
        setError(json.error ?? 'Request failed');
        return;
      }
      const serverMs = Date.parse(res.headers.get('date') ?? '');
      const offsetMs = Number.isNaN(serverMs) ? 0 : serverMs - Date.now();
      setAuction({
        id: json.auctionId,
        windowClosesAt: json.windowClosesAt,
        offsetMs,
        status: 'open',
        bids: [],
        bundles: json.bundles,
      });
    } finally {
      setBusy(false);
    }
  }

  const names = Object.fromEntries((auction?.bundles ?? []).map((b) => [b.restaurantId, b.name]));
  const remainingMs = auction ? Math.max(0, Date.parse(auction.windowClosesAt) - now) : 0;
  const windowOver = auction !== null && (auction.status !== 'open' || (now > 0 && remainingMs === 0));

  return (
    <div className="space-y-6">
      <VoiceInput value={text} onChange={setText} onSubmit={submit} disabled={busy} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {extracted && <MetadataCard intent={extracted} />}

      {auction && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium text-neutral-900">Live counter-bids</h2>
            <span className="font-mono text-sm text-neutral-700" aria-live="polite">
              {windowOver ? 'Window closed' : `${Math.ceil(remainingMs / 1000)}s left`}
            </span>
          </div>
          <CounterBidList bids={auction.bids} names={names} />

          {windowOver && auction.bundles.length > 0 && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-neutral-900 p-3">
                <p className="text-neutral-500">Winning Match</p>
                <p className="font-medium text-neutral-900">{auction.bundles[0].name}</p>
                <p className="text-neutral-700">₹{auction.bundles[0].offeredPriceInr}</p>
              </div>
              {auction.bundles[1] && (
                <div className="rounded-md border border-neutral-300 p-3">
                  <p className="text-neutral-500">Runner Up</p>
                  <p className="font-medium text-neutral-900">{auction.bundles[1].name}</p>
                  <p className="text-neutral-700">₹{auction.bundles[1].offeredPriceInr}</p>
                </div>
              )}
            </div>
          )}
          {windowOver && auction.bundles.length === 0 && (
            <p className="text-sm text-neutral-700">No kitchen matched this order.</p>
          )}
          {auction.dispatch && <DispatchPanel info={auction.dispatch} />}
          {auction.error && <p role="alert" className="text-sm text-red-700">{auction.error}</p>}
        </section>
      )}
    </div>
  );
}
