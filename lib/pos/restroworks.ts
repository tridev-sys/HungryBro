import { z } from 'zod';
import { verifyHmac } from '../webhooks/hmac';
import { parseMoney, toStation } from './common';
import { PosPayloadError, type MenuItemUpsert, type PosAdapter, type PosEvent } from './types';

const variationSchema = z.object({
  variationId: z.string().min(1),
  price: z.union([z.string(), z.number()]),
  inStock: z.boolean(),
});
const menuSchema = z.object({
  menu: z.object({
    sections: z.array(z.object({
      sectionName: z.string().min(1),
      stationTag: z.string().optional(),
      products: z.array(z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        variations: z.array(variationSchema),
      })),
    })),
  }),
});
const stockSchema = z.object({
  payload: z.object({ productId: z.string().min(1), variationId: z.string().min(1), inStock: z.boolean() }),
});

// Restroworks (Posist) sends variations and modifier sets. Each variation becomes one row;
// modifier sets are not stored here (Plan 03 carries them on the KDS ticket).
function mapMenu(providerMenu: unknown): MenuItemUpsert[] {
  const parsed = menuSchema.safeParse(providerMenu);
  if (!parsed.success) throw new PosPayloadError('invalid restroworks menu');
  return parsed.data.menu.sections.flatMap((section) =>
    section.products.flatMap((product) =>
      product.variations.map((v) => ({
        pos_item_code: `${product.productId}::${v.variationId}`,
        name: product.productName,
        base_price: parseMoney(v.price),
        is_in_stock: v.inStock,
        category_name: section.sectionName,
        station: toStation(section.stationTag),
      })),
    ),
  );
}

export const restroworksAdapter: PosAdapter = {
  provider: 'restroworks',
  // ASSUMED: base64 HMAC-SHA256 of the raw body in x-restroworks-signature.
  // VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding.
  verifySignature({ rawBody, headers, secret }) {
    return verifyHmac({ secret, payload: rawBody, signature: headers['x-restroworks-signature'], encoding: 'base64' });
  },
  parseWebhook(rawBody): PosEvent {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new PosPayloadError('body is not JSON');
    }
    const envelope = z.object({ topic: z.string() }).safeParse(json);
    if (!envelope.success) throw new PosPayloadError('missing topic');
    switch (envelope.data.topic) {
      case 'variation.stock': {
        const parsed = stockSchema.safeParse(json);
        if (!parsed.success) throw new PosPayloadError('invalid stock payload');
        const p = parsed.data.payload;
        return { kind: 'stock', pos_item_code: `${p.productId}::${p.variationId}`, is_in_stock: p.inStock };
      }
      case 'menu.sync':
        return { kind: 'menu', items: mapMenu(json), full: true };
      default:
        return { kind: 'ignored', reason: `unhandled topic ${envelope.data.topic}` };
    }
  },
  mapMenu,
};
