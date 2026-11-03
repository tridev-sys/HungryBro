import type { LatLng } from '@/types/food-os';

// Geohash cells for the mesh. Pure functions, no I/O.
export const MESH_GEOHASH_PRECISION = 5;

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

interface Box {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function decodeBox(cell: string): Box {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  for (const ch of cell) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`invalid geohash character: ${ch}`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (on) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (on) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function encodeGeohash(p: LatLng, precision: number = MESH_GEOHASH_PRECISION): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  let bit = 0;
  let ch = 0;
  let out = '';
  while (out.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (p.lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (p.lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export function decodeGeohashCenter(cell: string): LatLng {
  const b = decodeBox(cell);
  return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
}

export function geohashNeighbors(cell: string): string[] {
  const b = decodeBox(cell);
  const centre = decodeGeohashCenter(cell);
  const dLat = b.maxLat - b.minLat;
  const dLng = b.maxLng - b.minLng;
  const out = new Set<string>();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      if (dy === 0 && dx === 0) continue;
      out.add(encodeGeohash({ lat: centre.lat + dy * dLat, lng: centre.lng + dx * dLng }, cell.length));
    }
  }
  out.delete(cell);
  return [...out];
}

export function geohashBlock(cell: string): string[] {
  return [cell, ...geohashNeighbors(cell)];
}

export function meshChannel(cell: string): string {
  return `mesh:auction:${cell}`;
}

export function auctionEventsChannel(auctionId: string): string {
  return `mesh:auction:events:${auctionId}`;
}
