import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import type { KitchenCandidate, KitchenRepository, KitchenSearch, MatchedLine } from '@/lib/auction/engine';
import type { StationCategory } from '@/types/food-os';

// PostGIS-backed kitchen search. Reads are public (restaurant_nodes, menu_items
// and menu_categories have public read policies), so no user is bound.
// Points are always ST_MakePoint(lng, lat).
export function createPostgisKitchenRepository(pool: pg.Pool): KitchenRepository {
  return {
    async findCandidates(search: KitchenSearch): Promise<KitchenCandidate[]> {
      if (search.items.length === 0) return [];
      const { lat, lng } = search.point;
      return asRole(pool, null, async (c) => {
        const restaurants = await c.query(
          `SELECT r.id, r.name,
                  ST_Distance(r.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::float8 AS distance_m,
                  r.active_kds_load::float8 AS active_kds_load,
                  r.rating_aggregate::float8 AS rating_aggregate,
                  r.operational_floor_margin::float8 AS floor_margin
             FROM restaurant_nodes r
            WHERE ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
              AND r.active_kds_load < $4
              AND r.is_accepting_delivery`,
          [lng, lat, search.radiusM, search.maxLoad],
        );
        if (restaurants.rows.length === 0) return [];

        const ids = restaurants.rows.map((r) => r.id as string);
        const queries = search.items.map((i) => i.query);
        const items = await c.query(
          `SELECT q.idx, m.id, m.restaurant_id, m.name, m.base_price::float8 AS base_price,
                  COALESCE(cat.station, 'General') AS station
             FROM unnest($3::text[]) WITH ORDINALITY AS q(query, idx)
             JOIN menu_items m ON m.name ILIKE '%' || q.query || '%'
             LEFT JOIN menu_categories cat ON cat.id = m.category_id
            WHERE m.restaurant_id = ANY($1::uuid[])
              AND m.is_in_stock
              AND (cardinality($2::text[]) = 0 OR m.dietary::text = ANY($2::text[]))`,
          [ids, search.dietaryProfiles, queries],
        );

        // Cheapest matching item per (restaurant, query index).
        const best = new Map<string, Map<number, MatchedLine>>();
        for (const row of items.rows) {
          const perRestaurant = best.get(row.restaurant_id) ?? new Map();
          const idx = Number(row.idx) - 1;
          const current = perRestaurant.get(idx);
          if (!current || row.base_price < current.basePrice) {
            perRestaurant.set(idx, {
              itemId: row.id,
              name: row.name,
              basePrice: row.base_price,
              quantity: search.items[idx].servingTarget,
              station: row.station as StationCategory,
            });
          }
          best.set(row.restaurant_id, perRestaurant);
        }

        const out: KitchenCandidate[] = [];
        for (const r of restaurants.rows) {
          const perRestaurant = best.get(r.id);
          if (!perRestaurant || perRestaurant.size < search.items.length) continue;
          const lines: MatchedLine[] = search.items.map((_, idx) => perRestaurant.get(idx)!);
          out.push({
            restaurantId: r.id,
            name: r.name,
            distanceM: r.distance_m,
            activeKdsLoad: r.active_kds_load,
            ratingAggregate: r.rating_aggregate,
            floorMargin: r.floor_margin,
            lines,
          });
        }
        return out;
      });
    },
  };
}
