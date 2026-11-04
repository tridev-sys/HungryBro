// Removes only the fixtures this suite creates in the TEST database (perf-db): auctions whose
// transcript starts with "perf ", dining tables numbered "pf<run>-T<n>", their sessions, lines and
// tickets, and OTP challenges for test phones. Does not truncate anything.
import { adminPool, report } from './lib/common';

async function main() {
  const admin = adminPool();
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const tables = (await client.query(
      `SELECT id FROM dining_tables WHERE table_number ~ '^(pf[0-9a-f]{4}-T|perf-T)[0-9]+$'`)).rows.map((r) => r.id);
    const sessions = (await client.query(
      `SELECT id FROM tabletop_sessions WHERE table_id = ANY($1::uuid[])`, [tables])).rows.map((r) => r.id);
    const tickets = await client.query(`DELETE FROM kds_tickets WHERE session_id = ANY($1::uuid[])`, [sessions]);
    const lines = await client.query(`DELETE FROM tabletop_order_lines WHERE session_id = ANY($1::uuid[])`, [sessions]);
    const sess = await client.query(`DELETE FROM tabletop_sessions WHERE id = ANY($1::uuid[])`, [sessions]);
    const tbl = await client.query(`DELETE FROM dining_tables WHERE id = ANY($1::uuid[])`, [tables]);
    const auctions = await client.query(`DELETE FROM mesh_food_auctions WHERE voice_query_transcript LIKE 'perf %'`);
    const otp = await client.query(`DELETE FROM otp_challenges WHERE phone_e164 LIKE '+919%' AND phone_e164 ~ '^\\+91 ?9[0-9]{9}$'`);
    await client.query('COMMIT');
    report('cleanup', {
      tickets: tickets.rowCount, orderLines: lines.rowCount, sessions: sess.rowCount, tables: tbl.rowCount,
      auctions: auctions.rowCount, otpChallenges: otp.rowCount,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await admin.end();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
