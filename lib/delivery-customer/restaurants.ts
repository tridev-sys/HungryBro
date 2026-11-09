import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { formatRating } from '@/lib/restaurant/rating';

export interface DeliveryRestaurant {
  id: string;
  slug: string;
  name: string;
  ratingAggregate: number;
  totalVerifiedReviews: number;
  ratingText: string;
}

/** Restaurants that accept delivery, by name. Reads as an anonymous role (public read policy). */
export async function listDeliveryRestaurants(pool: pg.Pool): Promise<DeliveryRestaurant[]> {
  const { rows } = await asRole(pool, null, (c) =>
    c.query<{ id: string; slug: string; name: string; rating: number; reviews: number }>(
      `SELECT id, slug, name, rating_aggregate::float8 AS rating, total_verified_reviews AS reviews
         FROM restaurant_nodes
        WHERE is_accepting_delivery
        ORDER BY name, id`));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    ratingAggregate: r.rating,
    totalVerifiedReviews: r.reviews,
    ratingText: formatRating(r.rating, r.reviews),
  }));
}
