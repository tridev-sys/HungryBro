import { Bike, Clock, Thermometer } from 'lucide-react';

export interface DispatchInfo {
  provider: string;
  trackingRef: string;
  handshakeToken: string;
  rider: { name: string; vehicle: string };
  bagTempC: number;
  etaMinutes: number | null;
}

// The handshake token is shown only to the diner who owns the auction.
export default function DispatchPanel({ info }: { info: DispatchInfo }) {
  const token = info.handshakeToken.slice(0, 8);
  const formatted = token.length === 8 ? `${token.slice(0, 4)}-${token.slice(4)}` : token;
  return (
    <section className="space-y-3 rounded-md border border-neutral-200 p-4 text-sm">
      <h2 className="font-medium text-neutral-900">Delivery</h2>
      <div className="flex items-center gap-2 text-neutral-900">
        <Bike size={18} aria-hidden="true" />
        <span>
          {info.rider.name} ({info.rider.vehicle === 'EV_BIKE' ? 'EV bike' : info.rider.vehicle})
        </span>
      </div>
      <div className="flex items-center gap-2 text-neutral-900">
        <Thermometer size={18} aria-hidden="true" />
        <span>Hot bag {info.bagTempC} °C</span>
      </div>
      <div className="flex items-center gap-2 text-neutral-900">
        <Clock size={18} aria-hidden="true" />
        <span>ETA {info.etaMinutes ?? '--'} min</span>
      </div>
      <p className="text-neutral-700">
        Handshake code: <span className="font-mono text-neutral-900">{formatted}</span>
      </p>
    </section>
  );
}
