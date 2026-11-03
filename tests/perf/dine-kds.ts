// Check 3: 20 tables open sessions and add items at the same time (lib/dine/repository.ts and
// lib/dine/cart.ts, through the app role). Server actions need Next's action protocol, so this
// drives the same functions the actions call. Every fired ticket is also checked on the Redis
// KDS channel that the staff stream subscribes to.
// Per table: 3 cart updates, run concurrently across tables:
//   u1 ADD Chicken Biryani (Curry)            -> 1 ticket
//   u2 ADD Seekh Kebab (Tandoor)              -> 1 ticket
//   u3 ADD Biryani + Kebab (two stations)     -> 2 tickets
// Expected per table: 4 tickets (2 Curry, 2 Tandoor), 4 KDS events.
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { getPool } from '@/lib/db/client';
import { openTableSession } from '@/lib/dine/repository';
import { applyCartUpdate } from '@/lib/dine/cart';
import { kdsChannel } from '@/lib/kds/events';
import { adminPool, report, summarize } from './lib/common';
import type pg from 'pg';

const TABLES = 20;
// Unique per run, so a rerun never reuses another run's open sessions.
const PREFIX = `pf${randomBytes(2).toString('hex')}-T`;

async function main() {
  const admin = adminPool();
  const p = await getPool();
  const rest = (await admin.query(`SELECT id FROM restaurant_nodes WHERE slug = 'meghna-foods'`)).rows[0].id as string;
  const items = (await admin.query(
    `SELECT mi.id, mi.name, mc.station FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.restaurant_id = $1 AND mi.name IN ('Chicken Biryani','Seekh Kebab') ORDER BY mi.name`, [rest])).rows as Array<{ id: string; name: string; station: string }>;
  const biryani = items.find((i) => i.name === 'Chicken Biryani')!;
  const kebab = items.find((i) => i.name === 'Seekh Kebab')!;

  // Tables with unique numbers and known signatures (test fixtures, removed by cleanup.ts).
  console.error("step: fixtures");
  const sigs: string[] = [];
  for (let i = 1; i <= TABLES; i++) {
    const sig = randomBytes(16).toString('hex');
    sigs.push(sig);
    await admin.query(
      `INSERT INTO dining_tables (restaurant_id, table_number, seating_capacity, current_signature_token)
       VALUES ($1, $2, 4, $3) ON CONFLICT (restaurant_id, table_number) DO UPDATE SET current_signature_token = EXCLUDED.current_signature_token`,
      [rest, `${PREFIX}${String(i).padStart(2, '0')}`, sig]);
  }

  console.error("step: subscribe");
  const events: Array<{ ticket: { id?: string; ticketNumber?: number; station: string; restaurantId: string; sessionId: string } }> = [];
  const sub = new Redis(process.env.REDIS_URL!);
  await sub.subscribe(kdsChannel(rest));
  sub.on('message', (_ch: string, raw: string) => events.push(JSON.parse(raw)));

  // Open all 20 sessions at once.
  console.error("step: open sessions");
  const openT0 = performance.now();
  const sessions = await Promise.all(sigs.map((sig, i) =>
    openTableSession(p, { restaurantId: rest, tableNumber: `${PREFIX}${String(i + 1).padStart(2, '0')}`, signature: sig })));
  const openMs = Math.round(performance.now() - openT0);
  const distinctSessions = new Set(sessions.map((s) => s.sessionId)).size;

  const bodies = [
    { order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: biryani.id, name: biryani.name, station: biryani.station, quantity: 1 }] },
    { order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: kebab.id, name: kebab.name, station: kebab.station, quantity: 1 }] },
    { order_type: 'DINE_IN', action: 'ADD', items: [
      { item_id: biryani.id, name: biryani.name, station: biryani.station, quantity: 1 },
      { item_id: kebab.id, name: kebab.name, station: kebab.station, quantity: 1 }] },
  ];
  console.error("step: cart updates");
  const lat: number[] = [];
  const errors: string[] = [];
  const updateTickets: Array<Array<{ station: string }>> = [];
  const t0 = performance.now();
  await Promise.all(sessions.flatMap((s) => bodies.map(async (body) => {
    const t = performance.now();
    try {
      const r = await applyCartUpdate(p, { sessionToken: s.sessionToken, body });
      updateTickets.push(r.tickets);
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
    lat.push(performance.now() - t);
  })));
  const burstMs = Math.round(performance.now() - t0);
  // Let Redis deliver the last events.
  await new Promise((r) => setTimeout(r, 1000));

  const dbTickets = (await admin.query(
    `SELECT t.session_id, t.station, t.status, t.items, t.ticket_number FROM kds_tickets t
       JOIN tabletop_sessions s ON s.id = t.session_id JOIN dining_tables dt ON dt.id = s.table_id
      WHERE dt.restaurant_id = $1 AND dt.table_number LIKE $2`, [rest, `${PREFIX}%`])).rows as Array<{ session_id: string; station: string; status: string; items: Array<{ quantity: number; name: string; station?: string }>; ticket_number: number }>;
  const perSession = new Map<string, number>();
  for (const t of dbTickets) perSession.set(t.session_id, (perSession.get(t.session_id) ?? 0) + 1);
  const expectedPerSession = 4;
  const sessionsWithExpected = [...perSession.values()].filter((n) => n === expectedPerSession).length;
  const stationCounts = dbTickets.reduce<Record<string, number>>((a, t) => ({ ...a, [t.station]: (a[t.station] ?? 0) + 1 }), {});
  // No duplicate tickets: per session, each (station, item set) appears once per update, so
  // the ticket numbers must be unique and each session must have exactly the expected station split.
  const uniqueTicketNumbers = new Set(dbTickets.map((t) => t.ticket_number)).size === dbTickets.length;
  const updatesOk = errors.length === 0;

  // Every fired ticket reaches its station on the channel.
  const eventIds = new Set(events.map((e) => e.ticket.ticketNumber));
  const dbNumbers = new Set(dbTickets.map((t) => t.ticket_number));
  const missingOnChannel = [...dbNumbers].filter((n) => !eventIds.has(n)).length;
  const stationMismatch = events.filter((e) => {
    const row = dbTickets.find((t) => t.ticket_number === e.ticket.ticketNumber);
    return row ? row.station !== e.ticket.station : true;
  }).length;

  report('dine-kds', {
    tables: TABLES,
    sessionsOpened: sessions.length,
    distinctSessions,
    openSessionsMs: openMs,
    cartUpdates: bodies.length * TABLES,
    cartUpdateErrors: errors.length,
    errorSample: errors[0] ?? null,
    cartLatencyMs: summarize(lat),
    burstMs,
    ticketsInDb: dbTickets.length,
    expectedTickets: TABLES * expectedPerSession,
    sessionsWithExpectedTicketCount: sessionsWithExpected,
    stationCounts,
    uniqueTicketNumbers,
    kdsEventsReceived: events.length,
    firedTicketsMissingOnChannel: missingOnChannel,
    stationMismatchOnChannel: stationMismatch,
  });

  await sub.quit();
  await admin.end();
  await (p as pg.Pool).end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
