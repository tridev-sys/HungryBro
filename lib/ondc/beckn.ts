import { z } from 'zod';
import { round2 } from '../pricing';

// Parses recorded Beckn on_search and on_select envelopes into internal shapes.
// Pure: no network. Live ONDC onboarding is out of scope for Plan 06.

export interface BecknContext {
  domain: string;
  action: string;
  transaction_id: string;
  message_id: string;
  bap_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp: string;
}
export interface CatalogItem { externalId: string; name: string; priceInr: number; available: boolean }
export interface CatalogProvider { source: 'ondc'; bppId: string; providerId: string; providerName: string; items: CatalogItem[] }
export interface BundleQuote { source: 'ondc'; bppId: string; providerId: string; totalPriceInr: number; currency: 'INR'; fulfillmentId: string | null; etaMinutes: number | null }

export class BecknParseError extends Error {}

const contextSchema = z.object({
  domain: z.string(),
  action: z.string(),
  transaction_id: z.string(),
  message_id: z.string(),
  bap_id: z.string().optional(),
  bpp_id: z.string().optional(),
  bpp_uri: z.string().optional(),
  timestamp: z.string(),
});
const priceSchema = z.object({ currency: z.string(), value: z.string() });
const named = z.object({ name: z.string() });

const searchSchema = z.object({
  context: contextSchema,
  message: z.object({
    catalog: z.object({
      'bpp/providers': z.array(z.object({
        id: z.string(),
        descriptor: named,
        items: z.array(z.object({
          id: z.string(),
          descriptor: named,
          price: priceSchema,
          quantity: z.object({ available: z.object({ count: z.union([z.string(), z.number()]) }) }).optional(),
        })),
      })),
    }),
  }),
});

const selectSchema = z.object({
  context: contextSchema,
  message: z.object({
    order: z.object({
      provider: z.object({ id: z.string() }),
      fulfillments: z.array(z.object({
        id: z.string(),
        tags: z.array(z.object({
          code: z.string(),
          list: z.array(z.object({ code: z.string(), value: z.string() })),
        })).optional(),
      })).optional(),
      quote: z.object({ price: priceSchema }),
    }),
  }),
});

function inrAmount(p: { currency: string; value: string }): number {
  if (p.currency !== 'INR') throw new BecknParseError(`unsupported currency ${p.currency}`);
  const n = Number(p.value);
  if (!Number.isFinite(n) || n <= 0) throw new BecknParseError('price must be a positive number');
  return round2(n);
}

function requireBpp(ctx: BecknContext): string {
  if (!ctx.bpp_id) throw new BecknParseError('context.bpp_id is missing');
  return ctx.bpp_id;
}

export function parseOnSearch(envelope: unknown): CatalogProvider[] {
  const parsed = searchSchema.safeParse(envelope);
  if (!parsed.success) throw new BecknParseError('malformed on_search envelope');
  if (parsed.data.context.action !== 'on_search') throw new BecknParseError('expected action on_search');
  const bppId = requireBpp(parsed.data.context);
  return parsed.data.message.catalog['bpp/providers'].map((p) => ({
    source: 'ondc' as const,
    bppId,
    providerId: p.id,
    providerName: p.descriptor.name,
    items: p.items.map((i) => ({
      externalId: i.id,
      name: i.descriptor.name,
      priceInr: inrAmount(i.price),
      available: Number(i.quantity?.available.count ?? 0) > 0,
    })),
  }));
}

export function parseOnSelect(envelope: unknown): BundleQuote {
  const parsed = selectSchema.safeParse(envelope);
  if (!parsed.success) throw new BecknParseError('malformed on_select envelope');
  if (parsed.data.context.action !== 'on_select') throw new BecknParseError('expected action on_select');
  const order = parsed.data.message.order;
  const fulfillment = order.fulfillments?.[0];
  const eta = fulfillment?.tags
    ?.find((t) => t.code === 'ETA')
    ?.list.find((l) => l.code === 'MINUTES');
  const etaMinutes = eta !== undefined && Number.isFinite(Number(eta.value)) ? Number(eta.value) : null;
  return {
    source: 'ondc',
    bppId: requireBpp(parsed.data.context),
    providerId: order.provider.id,
    totalPriceInr: inrAmount(order.quote.price),
    currency: 'INR',
    fulfillmentId: fulfillment?.id ?? null,
    etaMinutes,
  };
}
