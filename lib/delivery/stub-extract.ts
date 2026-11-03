import type { LatLng } from '@/types/food-os';

// Deterministic regex stand-in for LLM extraction. Plan 04 replaces it.
export interface ExtractedIntent {
  budget_ceiling_inr?: number;
  sla_max_minutes?: number;
  headcount: number;
  target_dietary_profiles: string[];
  items_requested: Array<{ query: string; serving_target: number }>;
  locality?: string;
  client_coordinates?: LatLng;
}

// Pilot localities (tech-decisions). Approximate centroids (OWNER TO SET, row 4).
const LOCALITIES: Record<string, LatLng> = {
  Indiranagar: { lat: 12.9719, lng: 77.6408 },
  HSR: { lat: 12.925, lng: 77.641 },
};

export function extractIntentStub(text: string): ExtractedIntent {
  const headcount = Number(text.match(/for (\d+)/i)?.[1] ?? 1);
  const budgetMatch = text.match(/under ₹?(\d+)/i);
  const slaMatch = text.match(/in (\d+) ?min/i);
  const afterColon = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  const itemsPart = afterColon.split(/[,.]|\bstrictly\b|\bunder\b|\bin\s+\d+|\bdelivered\b|\bto\b/i)[0] ?? '';
  const items = itemsPart
    .split(/&|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((query) => ({ query, serving_target: 1 }));

  const locality = Object.keys(LOCALITIES).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(text));

  return {
    budget_ceiling_inr: budgetMatch ? Number(budgetMatch[1]) : undefined,
    sla_max_minutes: slaMatch ? Number(slaMatch[1]) : undefined,
    headcount,
    target_dietary_profiles: [],
    items_requested: items,
    locality,
    client_coordinates: locality ? LOCALITIES[locality] : undefined,
  };
}
