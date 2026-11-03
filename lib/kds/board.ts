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

// Ticket columns, qualified for the join to the table of the ticket's session.
const TICKET_COLUMNS = `k.id, k.ticket_number, k.restaurant_id, k.session_id, k.order_modality, k.station,
                        k.status, k.items, k.fired_at, k.bumped_at`;
const TICKET_FROM = `kds_tickets k
  LEFT JOIN tabletop_sessions s ON s.id = k.session_id
  LEFT JOIN dining_tables dt ON dt.id = s.table_id`;

type TicketWithTable = TicketRow & { table_number: string | null };

function view(r: TicketWithTable): TicketView {
  return toTicketView(r, r.table_number);
}

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
    const { rows } = await c.query<TicketWithTable>(
      `SELECT ${TICKET_COLUMNS}, dt.table_number FROM ${TICKET_FROM}
        WHERE k.restaurant_id = $1
          AND k.status IN ('queued', 'in_prep', 'ready', 'voided')
          AND ($2::text IS NULL OR k.station = $2)
        ORDER BY k.fired_at`,
      [restaurantId, station ?? null]);
    return rows.map(view);
  });
  const open = tickets.filter((t) => t.status !== 'voided').length;
  const load = kdsLoad(open);
  return { tickets, load, backpressure: backpressureWarning(load) };
}

async function lockTicket(c: pg.PoolClient, ticketId: string, restaurantId: string): Promise<TicketRow> {
  const { rows } = await c.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS} FROM kds_tickets k WHERE k.id = $1 FOR UPDATE OF k`, [ticketId]);
  const row = rows[0];
  // RLS hides other restaurants' tickets; a missing row or a mismatched restaurant is FORBIDDEN.
  if (!row || row.restaurant_id !== restaurantId) throw new Error('FORBIDDEN');
  return row;
}

async function readTicket(c: pg.PoolClient, ticketId: string): Promise<TicketView> {
  const { rows } = await c.query<TicketWithTable>(
    `SELECT ${TICKET_COLUMNS}, dt.table_number FROM ${TICKET_FROM} WHERE k.id = $1`, [ticketId]);
  return view(rows[0]);
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
    await c.query(`UPDATE kds_tickets SET items = $2, status = $3 WHERE id = $1`,
      [input.ticketId, JSON.stringify(items), next]);
    return readTicket(c, input.ticketId);
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
    await c.query(`UPDATE kds_tickets SET status = $2, items = $3, bumped_at = NOW() WHERE id = $1`,
      [input.ticketId, next, JSON.stringify(items)]);
    return readTicket(c, input.ticketId);
  });
  await refreshKitchenLoad(pool, actor.userId, input.restaurantId);
  return ticket;
}
