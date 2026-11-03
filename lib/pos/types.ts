import type { StationCategory } from '../../types/food-os';

export type PosProvider = 'petpooja' | 'restroworks' | 'urbanpiper';

// The POS sync writes only name, base_price, is_in_stock, and pos_item_code (shared decision 7).
// There is no dietary, spice, prep-time, description, or gst field: dietary is owner-only,
// and menu_items.gst_rate keeps its schema default of 0.05.
export interface MenuItemUpsert {
  pos_item_code: string;
  name: string;
  base_price: number; // INR, already round2
  is_in_stock: boolean;
  category_name: string; // resolved to menu_categories.id by upsert.ts
  station: StationCategory; // menu_categories.station, set when the category is created
}

export type PosEvent =
  | { kind: 'menu'; items: MenuItemUpsert[]; full: boolean; occurredAtMs?: number } // full = true for a full sync, false for a partial push
  | { kind: 'stock'; pos_item_code: string; is_in_stock: boolean; occurredAtMs?: number }
  | { kind: 'ignored'; reason: string };

export class PosPayloadError extends Error {}

export interface PosAdapter {
  readonly provider: PosProvider;
  verifySignature(args: { rawBody: string; headers: Record<string, string | undefined>; secret: string }): boolean;
  // Throws PosPayloadError. ctx is used by UrbanPiper only.
  parseWebhook(rawBody: string, ctx?: { expectedLocationId?: string }): PosEvent;
  // Throws PosPayloadError.
  mapMenu(providerMenu: unknown): MenuItemUpsert[];
}
