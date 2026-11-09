import { z } from 'zod';
import { MAX_LINE_QUANTITY } from './cart';

export const MAX_CART_LINES = 30;

const CartLinesShape = z.object({
  restaurantId: z.string().uuid(),
  lines: z
    .array(z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
    }))
    .min(1)
    .max(MAX_CART_LINES)
    .refine((lines) => new Set(lines.map((l) => l.menuItemId)).size === lines.length, {
      message: 'duplicate menu item',
    }),
});

const normalise = (v: z.infer<typeof CartLinesShape>) => ({
  restaurantId: v.restaurantId,
  lines: v.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
});

/** A cart as the browser sends it. Prices are not accepted: unknown keys are dropped and prices come from the database. */
export const CartSubmitSchema = CartLinesShape.transform(normalise);

/** Checkout: the cart, an idempotency key from the browser, and the diner's delivery auction if any. */
export const CheckoutSchema = CartLinesShape.extend({
  clientKey: z.string().min(8).max(64),
  auctionId: z.string().uuid().nullable().optional(),
}).transform((v) => ({ ...normalise(v), clientKey: v.clientKey, auctionId: v.auctionId ?? null }));

export type CartSubmit = z.infer<typeof CartSubmitSchema>;
export type CheckoutInput = z.infer<typeof CheckoutSchema>;
