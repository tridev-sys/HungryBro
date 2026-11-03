import { z } from 'zod';
import { CartUpdateSchema, DeliveryIntentSchema } from '@/types/food-os';
import type { ToolDef } from './types';

export const ReplySchema = z.object({
  reply_text: z.string().trim().min(1).max(400),
  reply_language: z.enum(['en', 'hi-en']),
});
export type Reply = z.infer<typeof ReplySchema>;

export const ActionPlanSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cart_update'), args: CartUpdateSchema }),
  z.object({ kind: z.literal('delivery_intent'), args: DeliveryIntentSchema }),
  z.object({ kind: z.literal('none') }),
]);
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'cart_update',
    description: 'Add, remove, or modify dine-in cart items the guest asked for.',
    schema: CartUpdateSchema,
  },
  {
    name: 'delivery_intent',
    description: 'Record a delivery request with budget, SLA, headcount, and requested items.',
    schema: DeliveryIntentSchema,
  },
  {
    name: 'respond',
    description: 'Reply to the guest. Call exactly once per turn.',
    schema: ReplySchema,
  },
];

export const SAFE_REPLY: Record<'en' | 'hi-en', string> = {
  en: 'Sorry, I did not catch that. Could you say it again?',
  'hi-en': 'Maaf kijiye, samajh nahin aaya. Phir se boliye?',
};
