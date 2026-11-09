import { z } from 'zod';
import { MAX_LINE_QUANTITY } from './cart';

export const MAX_CART_LINES = 30;

/** A cart as the browser sends it. Prices are not accepted: the server reads them from the database. */
export const CartSubmitSchema = z.object({
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
}).transform((v) => ({
  restaurantId: v.restaurantId,
  lines: v.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
}));

export type CartSubmit = z.infer<typeof CartSubmitSchema>;
