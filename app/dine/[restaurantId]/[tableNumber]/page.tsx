import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getPool } from '@/lib/db/client';
import { asSession } from '@/lib/db/session';
import { readTableSessionToken } from '@/lib/dine/cookie';
import { resolveActor } from '@/lib/auth/actor';
import { findRatableOrderRef } from '@/lib/ratings/prompt';
import { listSessionTickets } from '@/lib/dine/cart';
import { formatRating } from '@/lib/restaurant/rating';
import type { MenuCard } from '@/lib/menu/filters';
import type { AllergenTag, DietaryClassification, SessionStatus, SpiceLevel } from '@/types/food-os';
import { DineSurface, type DineSessionView } from '@/components/dine/DineSurface';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_RE = /^[0-9a-f]{32}$/;

export default async function DinePage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantId: string; tableNumber: string }>;
  searchParams: Promise<{ sig?: string | string[] }>;
}) {
  const { restaurantId, tableNumber } = await params;
  const { sig } = await searchParams;
  if (!UUID_RE.test(restaurantId)) notFound();
  const signature = typeof sig === 'string' && SIG_RE.test(sig) ? sig : null;

  const pool = await getPool();
  const restaurant = await pool.query<{ name: string; rating: number; verified: number }>(
    `SELECT name, rating_aggregate::float8 AS rating, total_verified_reviews AS verified
       FROM restaurant_nodes WHERE id = $1`,
    [restaurantId]);
  const row = restaurant.rows[0];
  if (!row) notFound();

  const menuRows = await pool.query<{
    id: string; name: string; price: number; dietary: DietaryClassification;
    spice_level: number; allergen_tags: AllergenTag[]; station: string;
  }>(
    `SELECT mi.id, mi.name, mi.base_price::float8 AS price, mi.dietary::text AS dietary,
            mi.spice_level, mi.allergen_tags, COALESCE(mc.station, 'General') AS station
       FROM menu_items mi
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.restaurant_id = $1 AND mi.is_in_stock
      ORDER BY mc.display_order NULLS LAST, mi.name`,
    [restaurantId]);
  const menu: MenuCard[] = menuRows.rows.map((m) => ({
    id: m.id,
    name: m.name,
    price: m.price,
    dietary: m.dietary,
    spiceLevel: m.spice_level as SpiceLevel,
    allergens: m.allergen_tags,
    station: m.station,
  }));

  // The table cookie is valid only for the table it was opened on.
  const cookieHeader = (await cookies()).toString();
  const token = readTableSessionToken(cookieHeader);
  let session: DineSessionView | null = null;
  let tickets: Awaited<ReturnType<typeof listSessionTickets>> = [];
  let ratingOrderRefId: string | null = null;
  if (token) {
    const found = await asSession(pool, { sessionToken: token }, (c) =>
      c.query<{ id: string; status: SessionStatus; subtotal: number; total: number; restaurant_id: string; table_number: string }>(
        `SELECT s.id, s.status, s.subtotal::float8 AS subtotal, s.total_amount::float8 AS total,
                dt.restaurant_id, dt.table_number
           FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
          WHERE s.session_token = $1`,
        [token]));
    const s = found.rows[0];
    if (s && s.restaurant_id === restaurantId && s.table_number === tableNumber) {
      session = { status: s.status, subtotal: s.subtotal, total: s.total };
      tickets = await listSessionTickets(pool, token);
      // Rating prompt: only for a settled session, and only for the signed-in diner who owns its order.
      if (s.status === 'closed') {
        const actor = await resolveActor(pool, cookieHeader);
        if (actor) ratingOrderRefId = await findRatableOrderRef(pool, actor.userId, s.id);
      }
    }
  }

  return (
    <DineSurface
      restaurantId={restaurantId}
      restaurantName={row.name}
      ratingLabel={formatRating(row.rating, row.verified)}
      tableNumber={tableNumber}
      signature={signature}
      session={session}
      tickets={tickets}
      menu={menu}
      ratingOrderRefId={ratingOrderRefId}
    />
  );
}
