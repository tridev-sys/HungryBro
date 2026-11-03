import { z } from 'zod';
import { verifyHmac } from '../webhooks/hmac';
import { parseMoney, toStation } from './common';
import { PosPayloadError, type MenuItemUpsert, type PosAdapter, type PosEvent } from './types';

const itemSchema = z.object({
  retailer_id: z.string().min(1),
  title: z.string().min(1),
  price: z.union([z.string(), z.number()]),
  available: z.boolean(),
  category: z.string().min(1),
  station: z.string().optional(),
});
const menuSchema = z.object({ location_id: z.string().optional(), items: z.array(itemSchema) });
const availabilitySchema = z.object({
  location_id: z.string().optional(),
  retailer_id: z.string().min(1),
  available: z.boolean(),
});

// UrbanPiper menus arrive per location. veg and spice_level are not mapped (shared decision 7).
function mapMenu(providerMenu: unknown): MenuItemUpsert[] {
  const parsed = menuSchema.safeParse(providerMenu);
  if (!parsed.success) throw new PosPayloadError('invalid urbanpiper menu');
  return parsed.data.items.map((item) => ({
    pos_item_code: item.retailer_id,
    name: item.title,
    base_price: parseMoney(item.price),
    is_in_stock: item.available,
    category_name: item.category,
    station: toStation(item.station),
  }));
}

function checkLocation(payloadLocation: string | undefined, expected: string | undefined): void {
  if (expected !== undefined && payloadLocation !== expected) {
    throw new PosPayloadError('location_id does not match this restaurant');
  }
}

export const urbanpiperAdapter: PosAdapter = {
  provider: 'urbanpiper',
  // ASSUMED: hex HMAC-SHA256 of the raw body in x-urbanpiper-signature.
  // VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding.
  verifySignature({ rawBody, headers, secret }) {
    return verifyHmac({ secret, payload: rawBody, signature: headers['x-urbanpiper-signature'], encoding: 'hex' });
  },
  parseWebhook(rawBody, ctx): PosEvent {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new PosPayloadError('body is not JSON');
    }
    const envelope = z.object({ event_type: z.string() }).safeParse(json);
    if (!envelope.success) throw new PosPayloadError('missing event_type');
    switch (envelope.data.event_type) {
      case 'item.availability': {
        const parsed = availabilitySchema.safeParse(json);
        if (!parsed.success) throw new PosPayloadError('invalid availability payload');
        checkLocation(parsed.data.location_id, ctx?.expectedLocationId);
        return { kind: 'stock', pos_item_code: parsed.data.retailer_id, is_in_stock: parsed.data.available };
      }
      case 'menu.sync': {
        const items = mapMenu(json);
        checkLocation((json as { location_id?: string }).location_id, ctx?.expectedLocationId);
        return { kind: 'menu', items, full: true };
      }
      default:
        return { kind: 'ignored', reason: `unhandled event ${envelope.data.event_type}` };
    }
  },
  mapMenu,
};
