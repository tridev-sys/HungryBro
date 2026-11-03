import { round2 } from '../pricing';
import type { StationCategory } from '../../types/food-os';
import { PosPayloadError } from './types';

const STATIONS: readonly StationCategory[] = ['Tandoor', 'Curry', 'Pantry', 'Bar', 'General'];

export function toStation(raw: string | undefined): StationCategory {
  return (STATIONS as readonly string[]).includes(raw ?? '') ? (raw as StationCategory) : 'General';
}

export function parseMoney(raw: string | number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new PosPayloadError(`invalid price: ${String(raw)}`);
  return round2(n);
}
