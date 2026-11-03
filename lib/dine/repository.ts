import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { asSession } from '@/lib/db/session';
import { canTransition } from './session-state';
import { issueSessionToken, verifyTableSignature } from './signature';
import { computeSettlement, type SettlementLine } from '@/lib/settlement/split';
import type { PaymentIntentAdapter } from '@/lib/payments/intent';
import type { SessionStatus } from '@/types/food-os';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_STATUSES: SessionStatus[] = ['active', 'payment_pending'];

export interface SplitParticipant {
  index: number;
  amount: number;
  intentId: string;
  paid: boolean;
}

/**
 * Legal moves only (session-state.ts), checked in code and then enforced by the guarded UPDATE.
 * Returns closed_at, which is set when the session moves to closed.
 */
export async function transitionSession(
  c: pg.PoolClient,
  sessionId: string,
  from: SessionStatus,
  to: SessionStatus,
  ctx: { anyShareSettled: boolean },
): Promise<Date | null> {
  if (!canTransition(from, to, ctx)) throw new Error('INVALID_TRANSITION');
  const closing = to === 'closed';
  const { rows, rowCount } = await c.query<{ closed_at: Date | null }>(
    `UPDATE tabletop_sessions
        SET status = $3${closing ? ', closed_at = NOW()' : ''}
      WHERE id = $1 AND status = $2
      RETURNING closed_at`,
    [sessionId, from, to],
  );
  if (rowCount === 0) throw new Error('INVALID_TRANSITION');
  return rows[0].closed_at;
}

export async function openTableSession(
  pool: pg.Pool,
  input: { restaurantId: string; tableNumber: string; signature: string; userId?: string | null },
): Promise<{ sessionId: string; sessionToken: string; status: SessionStatus }> {
  if (!UUID_RE.test(input.restaurantId)) throw new Error('TABLE_NOT_FOUND');
  const { rows } = await asRole(pool, null, (c) =>
    c.query<{ table_id: string; restaurant_id: string; current_signature_token: string }>(
      'SELECT table_id, restaurant_id, current_signature_token FROM app_lookup_table($1, $2)',
      [input.restaurantId, input.tableNumber]));
  const table = rows[0];
  if (!table) throw new Error('TABLE_NOT_FOUND');
  if (!verifyTableSignature(table.current_signature_token, input.signature)) throw new Error('INVALID_SIGNATURE');

  const findOpen = () => asSession(pool, { tableSignature: input.signature }, async (c) => {
    const r = await c.query<{ id: string; session_token: string; status: SessionStatus }>(
      `SELECT id, session_token, status FROM tabletop_sessions
        WHERE table_id = $1 AND status IN ('active', 'payment_pending')`,
      [table.table_id]);
    const s = r.rows[0];
    return s ? { sessionId: s.id, sessionToken: s.session_token, status: s.status } : null;
  });

  const existing = await findOpen();
  if (existing) return existing;

  const sessionToken = issueSessionToken();
  try {
    const created = await asSession(pool, { sessionToken, tableSignature: input.signature, userId: input.userId ?? null },
      async (c) => {
        const r = await c.query<{ id: string; status: SessionStatus }>(
          `INSERT INTO tabletop_sessions (table_id, session_token, diner_user_id)
           VALUES ($1, $2, $3) RETURNING id, status`,
          [table.table_id, sessionToken, input.userId ?? null]);
        return r.rows[0];
      });
    return { sessionId: created.id, sessionToken, status: created.status };
  } catch (err) {
    // A concurrent open won the partial unique index. Return that session, once.
    if ((err as { code?: string }).code !== '23505') throw err;
    const won = await findOpen();
    if (!won) throw err;
    return won;
  }
}

export interface SplitShare {
  index: number;
  amount: number;
  intentId: string;
  upiUri: string;
}

export async function requestSplit(
  pool: pg.Pool,
  adapter: PaymentIntentAdapter,
  input: { sessionToken: string; strategy: 'EQUAL' | 'BY_CONSUMPTION'; contributorCount: number },
): Promise<{ sessionId: string; subtotal: number; gst: number; total: number; shares: SplitShare[] }> {
  return asSession(pool, { sessionToken: input.sessionToken }, async (c) => {
    const s = await c.query<{ id: string; status: SessionStatus; restaurant_id: string }>(
      `SELECT s.id, s.status, dt.restaurant_id
         FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
        WHERE s.session_token = $1
        FOR UPDATE OF s`,
      [input.sessionToken]);
    const session = s.rows[0];
    if (!session || !canTransition(session.status, 'payment_pending', { anyShareSettled: false })) {
      throw new Error('SESSION_NOT_OPEN');
    }

    const lineRows = await c.query<{ unit_price: number; quantity: number; participant_index: number | null }>(
      `SELECT unit_price::float8 AS unit_price, quantity, participant_index
         FROM tabletop_order_lines WHERE session_id = $1`,
      [session.id]);
    if (lineRows.rowCount === 0) throw new Error('EMPTY_SESSION');
    const lines: SettlementLine[] = lineRows.rows.map((l) => ({
      unitPrice: l.unit_price, quantity: l.quantity, participantIndex: l.participant_index,
    }));

    const rest = await c.query<{ name: string; settlement_vpa: string | null }>(
      'SELECT name, settlement_vpa FROM restaurant_nodes WHERE id = $1', [session.restaurant_id]);
    const vpa = rest.rows[0]?.settlement_vpa;
    if (!vpa) throw new Error('NO_SETTLEMENT_VPA');

    const settlement = computeSettlement({
      lines, strategy: input.strategy, contributorCount: input.contributorCount,
    });
    const reference = `${session.id.slice(0, 8)}`;
    const shares: SplitShare[] = [];
    for (const share of settlement.shares) {
      const intent = await adapter.createUpiIntent({
        sessionId: session.id,
        shareIndex: share.index,
        amountInr: share.amount,
        payeeVpa: vpa,
        payeeName: rest.rows[0].name,
        reference: `${reference}-${share.index + 1}`,
      });
      shares.push({ index: share.index, amount: share.amount, intentId: intent.intentId, upiUri: intent.upiUri });
    }

    await transitionSession(c, session.id, session.status, 'payment_pending', { anyShareSettled: false });
    const participants: SplitParticipant[] = shares.map((x) => ({
      index: x.index, amount: x.amount, intentId: x.intentId, paid: false,
    }));
    await c.query(
      `UPDATE tabletop_sessions
          SET subtotal = $2, tax_amount = $3, total_amount = $4, bill_split_spec = $5
        WHERE id = $1`,
      [session.id, settlement.subtotal, settlement.gst, settlement.total,
        JSON.stringify({ strategy: input.strategy, contributor_count: input.contributorCount, participants })]);

    return {
      sessionId: session.id,
      subtotal: settlement.subtotal,
      gst: settlement.gst,
      total: settlement.total,
      shares,
    };
  });
}

export async function refreshSettlement(
  pool: pg.Pool,
  adapter: PaymentIntentAdapter,
  input: { sessionToken: string },
): Promise<{ status: SessionStatus; paidShares: number; totalShares: number }> {
  // The diner id never changes after the session opens, so reading it first is safe.
  const pre = await asSession(pool, { sessionToken: input.sessionToken }, (c) =>
    c.query<{ diner_user_id: string | null }>(
      'SELECT diner_user_id FROM tabletop_sessions WHERE session_token = $1', [input.sessionToken]));
  if (pre.rowCount === 0) throw new Error('SESSION_NOT_FOUND');
  const dinerId = pre.rows[0].diner_user_id;

  return asSession(pool, { sessionToken: input.sessionToken, userId: dinerId }, async (c) => {
    const r = await c.query<{
      id: string; status: SessionStatus; diner_user_id: string | null; restaurant_id: string;
      bill_split_spec: { strategy: string; contributor_count: number; participants: SplitParticipant[] };
    }>(
      `SELECT s.id, s.status, s.diner_user_id, dt.restaurant_id, s.bill_split_spec
         FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
        WHERE s.session_token = $1
        FOR UPDATE OF s`,
      [input.sessionToken]);
    const session = r.rows[0];
    if (!session) throw new Error('SESSION_NOT_FOUND');

    const spec = session.bill_split_spec;
    const participants = spec.participants ?? [];
    if (session.status !== 'payment_pending') {
      const paid = participants.filter((p) => p.paid).length;
      return { status: session.status, paidShares: paid, totalShares: participants.length };
    }

    for (const p of participants) {
      if (!p.paid && (await adapter.getStatus(p.intentId)) === 'settled') p.paid = true;
    }
    const paidShares = participants.filter((p) => p.paid).length;
    const allPaid = participants.length > 0 && paidShares === participants.length;
    let status: SessionStatus = session.status;

    if (allPaid) {
      await transitionSession(c, session.id, 'payment_pending', 'closed', { anyShareSettled: true });
      status = 'closed';
    }

    await c.query('UPDATE tabletop_sessions SET bill_split_spec = $2 WHERE id = $1',
      [session.id, JSON.stringify({ ...spec, participants })]);
    return { status, paidShares, totalShares: participants.length };
  });
}
