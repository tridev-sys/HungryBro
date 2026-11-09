import type pg from 'pg';
import { asRole } from '@/lib/db/client';

export interface MenuItemView {
  id: string;
  name: string;
  description: string | null;
  priceInr: number;
  dietary: string;
  spiceLevel: number;
  categoryName: string;
}

export interface MenuCategoryView {
  name: string;
  items: MenuItemView[];
}

export interface DeliveryMenu {
  restaurant: { id: string; name: string };
  items: MenuItemView[];
  categories: MenuCategoryView[];
}

/**
 * The in-stock menu of a restaurant that accepts delivery, or null when the restaurant is unknown or
 * not delivering. Public read policies apply (anonymous role). Prices are NUMERIC(10,2) read as numbers.
 */
export async function loadRestaurantMenu(pool: pg.Pool, restaurantId: string): Promise<DeliveryMenu | null> {
  return asRole(pool, null, async (c) => {
    const r = await c.query<{ id: string; name: string }>(
      'SELECT id, name FROM restaurant_nodes WHERE id = $1 AND is_accepting_delivery', [restaurantId]);
    if (r.rows.length === 0) return null;
    const { rows } = await c.query<{
      id: string; name: string; description: string | null; price: number; dietary: string;
      spice_level: number; category: string;
    }>(
      `SELECT mi.id, mi.name, mi.description, mi.base_price::float8 AS price, mi.dietary::text AS dietary,
              mi.spice_level, COALESCE(mc.name, 'Other') AS category
         FROM menu_items mi
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
        WHERE mi.restaurant_id = $1 AND mi.is_in_stock
        ORDER BY COALESCE(mc.display_order, 9999), COALESCE(mc.name, 'Other'), mi.name, mi.id`,
      [restaurantId]);
    const items: MenuItemView[] = rows.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      priceInr: Number(m.price),
      dietary: m.dietary,
      spiceLevel: m.spice_level,
      categoryName: m.category,
    }));
    const categories: MenuCategoryView[] = [];
    for (const item of items) {
      let group = categories.find((g) => g.name === item.categoryName);
      if (!group) {
        group = { name: item.categoryName, items: [] };
        categories.push(group);
      }
      group.items.push(item);
    }
    return { restaurant: { id: r.rows[0].id, name: r.rows[0].name }, items, categories };
  });
}
