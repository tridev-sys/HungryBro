import type pg from 'pg';
import { asSession } from '@/lib/db/session';
import { CartUpdateSchema } from '@/types/food-os';
import type { StationCategory, TicketStatus } from '@/types/food-os';
import { gstOn, round2 } from '@/lib/pricing';
import { allowsCartChanges } from './session-state';
import type { TicketItem, TicketView } from '@/lib/kds/ticket-view';
import { publishKdsEvent } from '@/lib/kds/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TicketRow {
  id: string;
  ticket_number: number;
  restaurant_id: string;
  session_id: string | null;
  order_modality: 'DINE_IN' | 'DELIVERY';
  station: StationCategory;
  status: TicketStatus;
  items: TicketItem[];
  fired_at: Date;
  bumped_at: Date | null;
}

export function toTicketView(r: TicketRow): TicketView {
  return {
    id: r.id,
    ticketNumber: r.ticket_number,
    restaurantId: r.restaurant_id,
    sessionId: r.session_id,
    orderModality: r.order_modality,
    station: r.station,
    status: r.status,
    items: r.items,
    firedAt: new Date(r.fired_at).toISOString(),
    bumpedAt: r.bumped_at ? new Date(r.bumped_at).toISOString() : null,
  };
}

/** Diner feed snapshot. RLS shows tickets only while the session is active. */
export async function listSessionTickets(pool: pg.Pool, sessionToken: string): Promise<TicketView[]> {
  return asSession(pool, { sessionToken }, async (c) => {
    const { rows } = await c.query<TicketRow>(
      `SELECT k.id, k.ticket_number, k.restaurant_id, k.session_id, k.order_modality, k.station,
              k.status, k.items, k.fired_at, k.bumped_at
         FROM kds_tickets k
         JOIN tabletop_sessions s ON s.id = k.session_id
        WHERE s.session_token = $1
        ORDER BY k.fired_at`,
      [sessionToken]);
    return rows.map(toTicketView);
  });
}

/**
 * Applies one cart change for a dine-in session. Price, name, and station come only from the
 * database (menu_items, menu_categories); client values are ignored.
 */
export async function applyCartUpdate(
  pool: pg.Pool,
  input: { sessionToken: string; body: unknown },
): Promise<{ tickets: TicketView[]; subtotal: number; total: number }> {
  const cart = CartUpdateSchema.parse(input.body);
  if (cart.order_type !== 'DINE_IN') throw new Error('DINE_IN_ONLY');

  const result = await asSession(pool, { sessionToken: input.sessionToken }, async (c) => {
    const s = await c.query<{ id: string; status: 'active' | 'payment_pending' | 'closed' | 'abandoned'; restaurant_id: string }>(
      `SELECT s.id, s.status, dt.restaurant_id
         FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
        WHERE s.session_token = $1
        FOR UPDATE OF s`,
      [input.sessionToken]);
    const session = s.rows[0];
    if (!session || !allowsCartChanges(session.status)) throw new Error('SESSION_NOT_OPEN');
    const sessionId = session.id;
    const restaurantId = session.restaurant_id;

    if (cart.action === 'BILL_SPLIT') {
      if (cart.items.length > 0) throw new Error('NO_ITEMS_ON_SPLIT');
      await c.query(`UPDATE tabletop_sessions SET bill_split_spec = $2 WHERE id = $1`, [sessionId, JSON.stringify({
        strategy: cart.split_metadata?.split_strategy ?? 'EQUAL',
        contributor_count: cart.split_metadata?.contributor_count ?? 1,
        participants: [],
      })]);
    }

    // Changed items grouped by station; each station gets one ticket.
    const byStation = new Map<StationCategory, TicketItem[]>();
    if (cart.action !== 'BILL_SPLIT') {
      for (const it of cart.items) {
        if (!UUID_RE.test(it.item_id)) throw new Error('UNKNOWN_ITEM');
        const m = await c.query<{ id: string; name: string; price: number; dietary: string; station: StationCategory; is_in_stock: boolean }>(
          `SELECT mi.id, mi.name, mi.base_price::float8 AS price, mi.dietary::text AS dietary,
                  COALESCE(mc.station, 'General') AS station, mi.is_in_stock
             FROM menu_items mi
             LEFT JOIN menu_categories mc ON mc.id = mi.category_id
            WHERE mi.id = $1 AND mi.restaurant_id = $2`,
          [it.item_id, restaurantId]);
        const menu = m.rows[0];
        if (!menu || !menu.is_in_stock) throw new Error('UNKNOWN_ITEM');
        const notes = it.preparation_notes ?? null;
        const dietaryFlags = [menu.dietary];

        let lineId: string;
        if (cart.action === 'ADD') {
          const line = await c.query<{ id: string }>(
            `INSERT INTO tabletop_order_lines
               (session_id, restaurant_id, menu_item_id, station, name, unit_price, quantity, preparation_notes, dietary_flags)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (session_id, menu_item_id) DO UPDATE
               SET quantity = tabletop_order_lines.quantity + EXCLUDED.quantity,
                   preparation_notes = COALESCE(EXCLUDED.preparation_notes, tabletop_order_lines.preparation_notes)
             RETURNING id`,
            [sessionId, restaurantId, menu.id, menu.station, menu.name, menu.price, it.quantity, notes, dietaryFlags]);
          lineId = line.rows[0].id;
        } else {
          const existing = await c.query<{ id: string; quantity: number }>(
            `SELECT id, quantity FROM tabletop_order_lines
              WHERE session_id = $1 AND menu_item_id = $2 FOR UPDATE`,
            [sessionId, menu.id]);
          const line = existing.rows[0];
          if (!line) throw new Error('UNKNOWN_LINE');
          lineId = line.id;
          if (cart.action === 'REMOVE') {
            if (it.quantity > line.quantity) throw new Error('QUANTITY_EXCEEDS_LINE');
            if (it.quantity === line.quantity) {
              await c.query('DELETE FROM tabletop_order_lines WHERE id = $1', [line.id]);
            } else {
              await c.query('UPDATE tabletop_order_lines SET quantity = quantity - $2 WHERE id = $1', [line.id, it.quantity]);
            }
          } else {
            await c.query('UPDATE tabletop_order_lines SET preparation_notes = $2 WHERE id = $1', [line.id, notes]);
          }
        }

        const change = cart.action === 'BILL_SPLIT' ? 'ADD' : cart.action;
        const item: TicketItem = {
          lineId,
          itemId: menu.id,
          name: menu.name,
          quantity: cart.action === 'REMOVE' ? -it.quantity : it.quantity,
          preparationNotes: notes,
          dietaryFlags,
          change,
          bumped: false,
        };
        const group = byStation.get(menu.station) ?? [];
        group.push(item);
        byStation.set(menu.station, group);
      }
    }

    const tickets: TicketView[] = [];
    const status: TicketStatus = cart.action === 'REMOVE' ? 'voided' : 'queued';
    for (const [station, items] of byStation) {
      const r = await c.query<TicketRow>(
        `INSERT INTO kds_tickets (restaurant_id, session_id, order_modality, station, status, items)
         VALUES ($1, $2, 'DINE_IN', $3, $4, $5)
         RETURNING id, ticket_number, restaurant_id, session_id, order_modality, station, status, items, fired_at, bumped_at`,
        [restaurantId, sessionId, station, status, JSON.stringify(items)]);
      tickets.push(toTicketView(r.rows[0]));
    }

    // Subtotal from every line in the session, in integer paise.
    const lines = await c.query<{ unit_price: number; quantity: number }>(
      `SELECT unit_price::float8 AS unit_price, quantity FROM tabletop_order_lines WHERE session_id = $1`,
      [sessionId]);
    const paise = lines.rows.reduce((acc, l) => acc + Math.round(l.unit_price * 100) * l.quantity, 0);
    const subtotal = round2(paise / 100);
    const tax = gstOn(subtotal);
    const total = round2(subtotal + tax);
    await c.query('UPDATE tabletop_sessions SET subtotal = $2, tax_amount = $3, total_amount = $4 WHERE id = $1',
      [sessionId, subtotal, tax, total]);

    return { tickets, subtotal, total };
  });

  // Publish only after the commit. A Redis failure must not undo a committed cart change.
  await Promise.all(result.tickets.map((ticket) =>
    publishKdsEvent({ type: 'ticket.fired', restaurantId: ticket.restaurantId, sessionId: ticket.sessionId, ticket })
      .catch((err: unknown) => console.error('kds publish failed', err))));
  return result;
}
