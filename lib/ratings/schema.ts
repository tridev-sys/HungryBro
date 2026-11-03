import { z } from 'zod';

export const RATING_TAGS = ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec'] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

export const SubmitRatingSchema = z.object({
  order_ref_id: z.string().uuid(),
  rating_score: z.number().int().min(1).max(5),
  review_tags: z
    .array(z.enum(RATING_TAGS))
    .max(4)
    .default([])
    .refine((tags) => new Set(tags).size === tags.length, { message: 'tags must be unique' }),
  feedback_text: z.string().max(500).optional(),
});

export type SubmitRatingInput = z.infer<typeof SubmitRatingSchema>;
