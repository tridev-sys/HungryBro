'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatINR } from '@/lib/ui/format';

export interface UpiShare {
  index: number;
  amount: number;
  upiUri: string;
}

export interface DynamicUpiQrModalProps {
  shares: UpiShare[];
  onClose: () => void;
}

/** One UPI QR per share. The payment is a fake intent until Plan 06 wires the gateways. */
export function DynamicUpiQrModal({ shares, onClose }: DynamicUpiQrModalProps) {
  const [images, setImages] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(shares.map(async (s) => [s.index, await QRCode.toDataURL(s.upiUri, { margin: 1, width: 240 })] as const))
      .then((pairs) => { if (!cancelled) setImages(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [shares]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Pay with UPI" className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 lg:items-center">
      <div className="w-full max-w-[430px] rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Pay your share</h2>
          <button type="button" onClick={onClose} className="min-h-[44px] px-3 text-sm">Close</button>
        </div>
        <ul className="mt-3 space-y-4">
          {shares.map((s) => (
            <li key={s.index} className="flex flex-col items-center gap-2">
              {images[s.index] ? <img src={images[s.index]} alt={`UPI QR for share ${s.index + 1}`} width={240} height={240} /> : null}
              <p className="text-sm tabular-nums">Share {s.index + 1}: {formatINR(s.amount)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
