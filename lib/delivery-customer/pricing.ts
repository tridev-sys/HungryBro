import type pg from 'pg';
import { gstOn, round2 } from '@/lib/pricing';

export type PriceCartResult =
  | {
      ok: true;
      restaurantId: string;
      lines: { menuItemId: string; name: string; unitPriceInr: number; quantity: number; lineTotalInr: number }[];
      subtotalInr: number;
      gstInr: number;
      totalInr: number;
    }
  | { ok: false; code: 'UNKNOWN_ITEM' | 'OUT_OF_STOCK' | 'RESTAURANT_CLOSED' };

/**
 * Prices a cart from menu_items for one restaurant. Runs on the caller's client (a transaction when
 * used by checkout), so the prices read here are the prices that get stored. Client prices never enter.
 */
export async function priceCart(
  c: Pick<pg.PoolClient, 'query'>,
  restaurantId: string,
  lines: { menuItemId: string; quantity: number }[],
): Promise<PriceCartResult> {
  const open = await c.query('SELECT 1 FROM restaurant_nodes WHERE id = $1 AND is_accepting_delivery', [restaurantId]);
  if ((open.rowCount ?? 0) === 0) return { ok: false, code: 'RESTAURANT_CLOSED' };

  const priced: { menuItemId: string; name: string; unitPriceInr: number; quantity: number; lineTotalInr: number }[] = [];
  for (const line of lines) {
    const { rows } = await c.query<{ name: string; price: number; in_stock: boolean }>(
      `SELECT name, base_price::float8 AS price, is_in_stock AS in_stock
         FROM menu_items WHERE id = $1 AND restaurant_id = $2`,
      [line.menuItemId, restaurantId]);
    const row = rows[0];
    if (!row) return { ok: false, code: 'UNKNOWN_ITEM' };
    if (!row.in_stock) return { ok: false, code: 'OUT_OF_STOCK' };
    const unit = round2(Number(row.price));
    priced.push({
      menuItemId: line.menuItemId,
      name: row.name,
      unitPriceInr: unit,
      quantity: line.quantity,
      lineTotalInr: round2(unit * line.quantity),
    });
  }
  const subtotalInr = round2(priced.reduce((s, l) => s + l.lineTotalInr, 0));
  const gstInr = gstOn(subtotalInr);
  return { ok: true, restaurantId, lines: priced, subtotalInr, gstInr, totalInr: round2(subtotalInr + gstInr) };
}
