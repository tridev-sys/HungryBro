'use client';

import { useEffect, useState } from 'react';
import VoiceInput from './VoiceInput';
import MetadataCard from './MetadataCard';
import CounterBidList, { type BidRow } from './CounterBidList';
import DispatchPanel, { type DispatchInfo } from './DispatchPanel';
import { extractIntentStub, type ExtractedIntent } from '@/lib/delivery/stub-extract';
import { LatLngSchema, type LatLng } from '@/types/food-os';
import { requestBrowserLocation, type LocationState } from '@/lib/location/browser-location';

// Status line under the coordinate fields. The alert on submit carries the instruction.
const LOCATION_STATUS: Record<Exclude<LocationState['status'], 'located'>, string> = {
  requesting: 'Finding your location...',
  denied: 'Location access was denied. Enter your coordinates below.',
  unavailable: 'Your location is unavailable. Enter your coordinates below.',
  timeout: 'Locating you timed out. Enter your coordinates below.',
};

// Same bounds as DeliveryIntentSchema.client_coordinates (LatLngSchema), so the console rejects
// exactly what the API would reject with 400.
type CoordField = 'lat' | 'lng';
const COORD_MESSAGE: Record<CoordField, string> = {
  lat: 'Latitude must be between -90 and 90',
  lng: 'Longitude must be between -180 and 180',
};

function checkCoord(field: CoordField, raw: string): string | undefined {
  if (raw.trim() === '') return undefined; // blank means "use the locality"
  return LatLngSchema.shape[field].safeParse(Number(raw)).success ? undefined : COORD_MESSAGE[field];
}

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
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [coordErrors, setCoordErrors] = useState<Partial<Record<CoordField, string>>>({});
  const [location, setLocation] = useState<LocationState>({ status: 'requesting' });

  // Live position when the screen opens. Nothing is hardcoded: a denial or timeout leaves manual entry.
  useEffect(() => {
    let alive = true;
    requestBrowserLocation(navigator.geolocation).then((state) => {
      if (alive) setLocation(state);
    });
    return () => {
      alive = false;
    };
  }, []);

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

    // Out-of-range coordinates are shown next to the field and never sent.
    const latError = checkCoord('lat', latText);
    const lngError = checkCoord('lng', lngText);
    setCoordErrors({ lat: latError, lng: lngError });
    if (latError || lngError) {
      setExtracted(null);
      return;
    }

    // Typed coordinates win when both are given; otherwise the diner's live browser position.
    // A locality named in the text never supplies coordinates: only the diner's own fix or input is sent.
    const latTrim = latText.trim();
    const lngTrim = lngText.trim();
    const partial = (latTrim === '') !== (lngTrim === '');
    const typed: LatLng | undefined = latTrim && lngTrim ? { lat: Number(latTrim), lng: Number(lngTrim) } : undefined;
    const live: LatLng | undefined = location.status === 'located' ? { lat: location.lat, lng: location.lng } : undefined;
    const coords = typed ?? live;
    setExtracted({ ...parsed, client_coordinates: coords });
    if (partial) {
      setError('Enter both latitude and longitude, or leave both blank to use your location.');
      return;
    }
    if (!coords) {
      setError('Enter your latitude and longitude below, or allow location access.');
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
      client_coordinates: coords,
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
      <fieldset className="grid grid-cols-2 gap-3 text-sm">
        <legend className="col-span-2 text-[var(--color-text-muted)]">
          Coordinates (optional, leave blank to use your live location)
        </legend>
        {location.status !== 'located' && (
          <p role="status" className="col-span-2 text-[var(--color-text-muted)]">
            {LOCATION_STATUS[location.status]}
          </p>
        )}
        {location.status === 'located' && (
          <p role="status" className="col-span-2 text-[var(--color-text-muted)]">Using your current location.</p>
        )}
        <div className="space-y-1">
          <label htmlFor="delivery-latitude" className="block text-[var(--color-text-muted)]">Latitude</label>
          <input
            id="delivery-latitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={-90}
            max={90}
            value={latText}
            onChange={(e) => {
              setLatText(e.target.value);
              setCoordErrors((c) => ({ ...c, lat: undefined }));
            }}
            disabled={busy}
            aria-invalid={coordErrors.lat ? true : undefined}
            aria-describedby={coordErrors.lat ? 'delivery-latitude-error' : undefined}
            className="min-h-[44px] w-full min-w-0 rounded-md border border-[var(--color-surface-2)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          />
          {coordErrors.lat && (
            <p id="delivery-latitude-error" role="alert" className="text-xs text-[var(--color-sla-red)]">
              {coordErrors.lat}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="delivery-longitude" className="block text-[var(--color-text-muted)]">Longitude</label>
          <input
            id="delivery-longitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={-180}
            max={180}
            value={lngText}
            onChange={(e) => {
              setLngText(e.target.value);
              setCoordErrors((c) => ({ ...c, lng: undefined }));
            }}
            disabled={busy}
            aria-invalid={coordErrors.lng ? true : undefined}
            aria-describedby={coordErrors.lng ? 'delivery-longitude-error' : undefined}
            className="min-h-[44px] w-full min-w-0 rounded-md border border-[var(--color-surface-2)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          />
          {coordErrors.lng && (
            <p id="delivery-longitude-error" role="alert" className="text-xs text-[var(--color-sla-red)]">
              {coordErrors.lng}
            </p>
          )}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-[var(--color-sla-red)]">{error}</p>}
      {extracted && <MetadataCard intent={extracted} />}

      {auction && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium text-[var(--color-text)]">Live counter-bids</h2>
            <span className="font-mono text-sm text-[var(--color-text)]" aria-live="polite">
              {windowOver ? 'Window closed' : `${Math.ceil(remainingMs / 1000)}s left`}
            </span>
          </div>
          <CounterBidList bids={auction.bids} names={names} />

          {windowOver && auction.bundles.length > 0 && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-[var(--color-accent)] p-3">
                <p className="text-[var(--color-text-muted)]">Winning Match</p>
                <p className="font-medium text-[var(--color-text)]">{auction.bundles[0].name}</p>
                <p className="text-[var(--color-text)]">₹{auction.bundles[0].offeredPriceInr}</p>
              </div>
              {auction.bundles[1] && (
                <div className="rounded-md border border-[var(--color-surface-2)] p-3">
                  <p className="text-[var(--color-text-muted)]">Runner Up</p>
                  <p className="font-medium text-[var(--color-text)]">{auction.bundles[1].name}</p>
                  <p className="text-[var(--color-text)]">₹{auction.bundles[1].offeredPriceInr}</p>
                </div>
              )}
            </div>
          )}
          {windowOver && auction.bundles.length === 0 && (
            <p className="text-sm text-[var(--color-text)]">No kitchen matched this order.</p>
          )}
          {auction.dispatch && <DispatchPanel info={auction.dispatch} />}
          {auction.error && <p role="alert" className="text-sm text-[var(--color-sla-red)]">{auction.error}</p>}
        </section>
      )}
    </div>
  );
}
