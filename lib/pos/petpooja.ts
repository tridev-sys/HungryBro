import { z } from 'zod';
import { verifyHmac } from '../webhooks/hmac';
import { parseMoney, toStation } from './common';
import { PosPayloadError, type MenuItemUpsert, type PosAdapter, type PosEvent } from './types';

const itemSchema = z.object({
  itemid: z.string().min(1),
  itemname: z.string().min(1),
  price: z.union([z.string(), z.number()]),
  instock: z.union([z.string(), z.number()]),
  station: z.string().optional(),
});
const menuSchema = z.object({
  restID: z.string(),
  categories: z.array(z.object({ categoryname: z.string().min(1), items: z.array(itemSchema) })),
});
const stockSchema = z.object({
  data: z.object({ itemid: z.string().min(1), instock: z.union([z.string(), z.number()]) }),
});

function mapMenu(providerMenu: unknown): MenuItemUpsert[] {
  const parsed = menuSchema.safeParse(providerMenu);
  if (!parsed.success) throw new PosPayloadError('invalid petpooja menu');
  return parsed.data.categories.flatMap((cat) =>
    cat.items.map((item) => ({
      pos_item_code: item.itemid,
      name: item.itemname,
      base_price: parseMoney(item.price),
      is_in_stock: String(item.instock) === '1',
      category_name: cat.categoryname,
      station: toStation(item.station),
    })),
  );
}

export const petpoojaAdapter: PosAdapter = {
  provider: 'petpooja',
  // ASSUMED: hex HMAC-SHA256 of the raw body in x-petpooja-signature.
  // VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding.
  verifySignature({ rawBody, headers, secret }) {
    return verifyHmac({ secret, payload: rawBody, signature: headers['x-petpooja-signature'], encoding: 'hex' });
  },
  parseWebhook(rawBody): PosEvent {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new PosPayloadError('body is not JSON');
    }
    const envelope = z.object({ event: z.string() }).safeParse(json);
    if (!envelope.success) throw new PosPayloadError('missing event');
    switch (envelope.data.event) {
      case 'item.stock': {
        const parsed = stockSchema.safeParse(json);
        if (!parsed.success) throw new PosPayloadError('invalid stock payload');
        return {
          kind: 'stock',
          pos_item_code: parsed.data.data.itemid,
          is_in_stock: String(parsed.data.data.instock) === '1',
        };
      }
      case 'menu.sync':
        return { kind: 'menu', items: mapMenu(json), full: true };
      default:
        return { kind: 'ignored', reason: `unhandled event ${envelope.data.event}` };
    }
  },
  mapMenu,
};
