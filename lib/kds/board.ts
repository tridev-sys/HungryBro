import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import type { Actor } from '@/lib/auth/actor';
import { toTicketView } from '@/lib/dine/cart';
import type { StationCategory, TicketStatus } from '@/types/food-os';
import type { TicketItem, TicketView } from './ticket-view';
import { nextStatusAfterBump, nextStatusAfterTicketBump } from './transitions';
import { backpressureWarning, kdsLoad, refreshKitchenLoad } from './load';

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

const TICKET_COLUMNS = `id, ticket_number, restaurant_id, session_id, order_modality, station,
                        status, items, fired_at, bumped_at`;

function assertSameRestaurant(actor: Actor, restaurantId: string): void {
  if (actor.restaurantId !== restaurantId) throw new Error('FORBIDDEN');
}

/** Open tickets (queued, in_prep, ready, voided), oldest first. Refreshes the load first. */
export async function loadBoard(
  pool: pg.Pool,
  actor: Actor,
  restaurantId: string,
  station?: StationCategory,
): Promise<{ tickets: TicketView[]; load: number; backpressure: boolean }> {
  assertSameRestaurant(actor, restaurantId);
  await refreshKitchenLoad(pool, actor.userId, restaurantId);
  const tickets = await asRole(pool, actor.userId, async (c) => {
    const { rows } = await c.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM kds_tickets
        WHERE restaurant_id = $1
          AND status IN ('queued', 'in_prep', 'ready', 'voided')
          AND ($2::text IS NULL OR station = $2)
        ORDER BY fired_at`,
      [restaurantId, station ?? null]);
    return rows.map(toTicketView);
  });
  const open = tickets.filter((t) => t.status !== 'voided').length;
  const load = kdsLoad(open);
  return { tickets, load, backpressure: backpressureWarning(load) };
}

async function lockTicket(c: pg.PoolClient, ticketId: string, restaurantId: string): Promise<TicketRow> {
  const { rows } = await c.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM kds_tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
  const row = rows[0];
  // RLS hides other restaurants' tickets; a missing row or a mismatched restaurant is FORBIDDEN.
  if (!row || row.restaurant_id !== restaurantId) throw new Error('FORBIDDEN');
  return row;
}

export async function bumpItem(
  pool: pg.Pool,
  actor: Actor,
  input: { restaurantId: string; ticketId: string; itemIndex: number },
): Promise<TicketView> {
  assertSameRestaurant(actor, input.restaurantId);
  const ticket = await asRole(pool, actor.userId, async (c) => {
    const row = await lockTicket(c, input.ticketId, input.restaurantId);
    const items = row.items.map((it) => ({ ...it }));
    const target = items[input.itemIndex];
    if (!target) throw new Error('UNKNOWN_ITEM_INDEX');
    const allBumped = items.every((it, i) => i === input.itemIndex || it.bumped);
    const next = nextStatusAfterBump(row.status, allBumped);
    target.bumped = true;
    const { rows } = await c.query<TicketRow>(
      `UPDATE kds_tickets SET items = $2, status = $3 WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
      [input.ticketId, JSON.stringify(items), next]);
    return toTicketView(rows[0]);
  });
  await refreshKitchenLoad(pool, actor.userId, input.restaurantId);
  return ticket;
}

export async function bumpTicket(
  pool: pg.Pool,
  actor: Actor,
  input: { restaurantId: string; ticketId: string },
): Promise<TicketView> {
  assertSameRestaurant(actor, input.restaurantId);
  const ticket = await asRole(pool, actor.userId, async (c) => {
    const row = await lockTicket(c, input.ticketId, input.restaurantId);
    const next = nextStatusAfterTicketBump(row.status);
    const items = row.items.map((it) => ({ ...it, bumped: true }));
    const { rows } = await c.query<TicketRow>(
      `UPDATE kds_tickets SET status = $2, items = $3, bumped_at = NOW()
        WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
      [input.ticketId, next, JSON.stringify(items)]);
    return toTicketView(rows[0]);
  });
  await refreshKitchenLoad(pool, actor.userId, input.restaurantId);
  return ticket;
}
