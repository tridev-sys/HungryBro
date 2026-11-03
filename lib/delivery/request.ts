import { z } from 'zod';
import { DeliveryIntentSchema } from '@/types/food-os';

export const DeliveryRequestSchema = z.object({
  transcript: z.string().min(1).max(500),
  intent: DeliveryIntentSchema,
});
export type DeliveryRequest = z.infer<typeof DeliveryRequestSchema>;
