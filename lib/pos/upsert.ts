import type pg from 'pg';
import type { StationCategory } from '../../types/food-os';
import type { MenuItemUpsert } from './types';

export class EmptyMenuError extends Error {}

async function ensureCategory(
  c: pg.PoolClient,
  restaurantId: string,
  name: string,
  station: StationCategory,
): Promise<string> {
  const inserted = await c.query(
    `INSERT INTO menu_categories (restaurant_id, name, station)
     SELECT $1::uuid, $2::text, $3::text
     WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE restaurant_id = $1 AND name = $2)
     RETURNING id`,
    [restaurantId, name, station],
  );
  if (inserted.rows.length > 0) return inserted.rows[0].id as string;
  const existing = await c.query(
    'SELECT id FROM menu_categories WHERE restaurant_id = $1 AND name = $2',
    [restaurantId, name],
  );
  return existing.rows[0].id as string;
}

/**
 * Idempotent upsert keyed by (restaurant_id, pos_item_code). The DO UPDATE list never
 * touches dietary, description, spice_level, preparation_time_minutes, or gst_rate
 * (shared decision 7). When `full` is true, items missing from the payload are marked
 * out of stock, never deleted.
 */
export async function upsertMenu(
  c: pg.PoolClient,
  restaurantId: string,
  items: MenuItemUpsert[],
  opts: { full: boolean },
): Promise<{ inserted: number; updated: number; markedOutOfStock: number }> {
  if (opts.full && items.length === 0) {
    throw new EmptyMenuError('refusing to apply a full menu sync with zero items');
  }

  const categoryIds = new Map<string, string>();
  for (const item of items) {
    if (!categoryIds.has(item.category_name)) {
      categoryIds.set(item.category_name, await ensureCategory(c, restaurantId, item.category_name, item.station));
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    const { rows } = await c.query(
      `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, is_in_stock, category_id, dietary)
       VALUES ($1, $2, $3, $4, $5, $6, 'non_veg')
       ON CONFLICT (restaurant_id, pos_item_code) DO UPDATE SET
         name = EXCLUDED.name,
         base_price = EXCLUDED.base_price,
         is_in_stock = EXCLUDED.is_in_stock,
         category_id = EXCLUDED.category_id
       RETURNING (xmax = 0) AS inserted`,
      [restaurantId, item.pos_item_code, item.name, item.base_price, item.is_in_stock, categoryIds.get(item.category_name)],
    );
    if (rows[0].inserted) inserted += 1;
    else updated += 1;
  }

  let markedOutOfStock = 0;
  if (opts.full) {
    const codes = items.map((i) => i.pos_item_code);
    const res = await c.query(
      `UPDATE menu_items SET is_in_stock = false
       WHERE restaurant_id = $1 AND pos_item_code <> ALL($2::text[]) AND is_in_stock = true`,
      [restaurantId, codes],
    );
    markedOutOfStock = res.rowCount ?? 0;
  }

  return { inserted, updated, markedOutOfStock };
}

export async function setStock(
  c: pg.PoolClient,
  restaurantId: string,
  posItemCode: string,
  inStock: boolean,
): Promise<number> {
  const res = await c.query(
    'UPDATE menu_items SET is_in_stock = $3 WHERE restaurant_id = $1 AND pos_item_code = $2',
    [restaurantId, posItemCode, inStock],
  );
  return res.rowCount ?? 0;
}
