import { z } from 'zod';

export type UserRole = 'guest' | 'diner' | 'restaurant_staff' | 'kitchen_lead' | 'delivery_agent' | 'platform_admin';
export type DietaryClassification = 'pure_veg' | 'jain' | 'halal' | 'non_veg' | 'vegan' | 'egg';
export type StationCategory = 'Tandoor' | 'Curry' | 'Pantry' | 'Bar' | 'General';
export type TicketStatus = 'queued' | 'in_prep' | 'ready' | 'served' | 'voided';
export type SessionStatus = 'active' | 'payment_pending' | 'closed' | 'abandoned';
export type AuctionStatus = 'open' | 'evaluating' | 'awarded' | 'fulfilled' | 'expired' | 'cancelled';

export type SpiceLevel = 0 | 1 | 2 | 3;
export type AllergenTag = 'peanut' | 'shellfish' | 'dairy' | 'gluten';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const CartUpdateSchema = z.object({
  table_id: z.string().optional(),
  order_type: z.enum(['DINE_IN', 'DELIVERY']),
  action: z.enum(['ADD', 'REMOVE', 'MODIFY', 'BILL_SPLIT']),
  items: z.array(
    z.object({
      item_id: z.string(),
      name: z.string(),
      station: z.enum(['Tandoor', 'Curry', 'Pantry', 'Bar', 'General']).default('General'),
      quantity: z.number().int().positive(),
      preparation_notes: z.string().max(100).optional(),
      dietary_flags: z.array(z.string()).default([])
    })
  ),
  split_metadata: z.object({
    split_strategy: z.enum(['EQUAL', 'BY_CONSUMPTION']).optional(),
    contributor_count: z.number().int().min(1).optional()
  }).optional()
});
export type CartUpdate = z.infer<typeof CartUpdateSchema>;

export const DeliveryIntentSchema = z.object({
  modality: z.literal('DELIVERY'),
  // Ceiling keeps the value inside NUMERIC(10,2) and well above any realistic order (INR).
  budget_ceiling_inr: z.number().positive().max(100000),
  sla_max_minutes: z.number().int().min(15).max(120),
  headcount: z.number().int().min(1).default(1),
  target_dietary_profiles: z.array(z.string()),
  items_requested: z.array(z.object({
    query: z.string().max(100),
    serving_target: z.number().default(1)
  })).max(20),
  client_coordinates: LatLngSchema
});
export type DeliveryIntent = z.infer<typeof DeliveryIntentSchema>;
