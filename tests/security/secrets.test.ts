// Check 7: secrets. No response body, log line or error message may contain POS credentials, the POS
// credentials key, the session signing secret, the webhook secrets, or a session token.
import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POST as posPOST } from '@/app/api/pos/[provider]/[restaurantId]/route';
import { POST as razorpayPOST } from '@/app/api/webhooks/razorpay/route';
import { POST as intentPOST } from '@/app/api/delivery/intent/route';
import { POST as ratingsPOST } from '@/app/api/ratings/route';
import { openTableSession } from '@/lib/dine/repository';
import { getPool } from '@/lib/db/client';
import { issueSession, SESSION_COOKIE } from '@/lib/auth/session';
import { prepareDatabase, closeAll, admin, buildWorld, type World, sessionCookie, jsonRequest } from './helpers';

const RZP_SECRET = 'sec-rzp-leak-check-5d1e77';
let w: World;
let captured: string[] = [];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = RZP_SECRET;
  await prepareDatabase();
  w = await buildWorld();
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const spy = vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : safeStr(a))).join(' '));
    });
    spies.push(spy);
  }
});
afterAll(async () => {
  for (const s of spies) s.mockRestore();
  await closeAll();
});

function safeStr(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Everything a caller or an operator could read: response bodies, console output, thrown messages. */
async function observe(fn: () => Promise<Response>): Promise<string> {
  captured = [];
  let body = '';
  try {
    const res = await fn();
    body = await res.text();
    body += ` [status ${res.status}]`;
  } catch (err) {
    body = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  }
  return [body, ...captured].join('\n');
}

function secretsUnderTest(): Record<string, string> {
  return {
    'POS webhook secret (Y)': w.yPosSecret,
    'POS API key (Y)': w.yPosApiKey,
    'POS credentials key (base64)': process.env.POS_CREDENTIALS_KEY ?? '',
    'session signing secret': process.env.AUTH_JWT_SECRET ?? '',
    'Razorpay webhook secret': RZP_SECRET,
  };
}

function assertNoSecrets(output: string, label: string): void {
  for (const [name, value] of Object.entries(secretsUnderTest())) {
    if (!value) continue;
    if (output.includes(value)) throw new Error(`${label} leaked the ${name}`);
  }
}

test('control: the console capture sees what the code logs', async () => {
  captured = [];
  console.log('control line for the capture');
  expect(captured.join('\n')).toContain('control line for the capture');
});

test('POS webhook: wrong-signature 401 response and log leak nothing', async () => {
  const raw = readFileSync(path.join(__dirname, '../fixtures/pos', 'petpooja-stock-webhook.json'), 'utf8');
  const out = await observe(() => posPOST(
    new Request(`http://localhost:3000/api/pos/petpooja/${w.rY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-petpooja-signature': createHmac('sha256', 'wrong').update(raw).digest('hex') },
      body: raw,
    }),
    { params: Promise.resolve({ provider: 'petpooja', restaurantId: w.rY }) }));
  expect(out).toMatch(/401/);
  assertNoSecrets(out, 'POS wrong-signature path');
});

test('POS webhook: valid signature with a malformed payload (400) leaks nothing', async () => {
  const bad = '{"event":"menu.sync","categories":"nope"}';
  const sig = createHmac('sha256', w.yPosSecret).update(bad).digest('hex');
  const out = await observe(() => posPOST(
    new Request(`http://localhost:3000/api/pos/petpooja/${w.rY}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-petpooja-signature': sig }, body: bad,
    }),
    { params: Promise.resolve({ provider: 'petpooja', restaurantId: w.rY }) }));
  assertNoSecrets(out, 'POS malformed-payload path');
});

test('POS webhook: unknown restaurant (404) leaks nothing', async () => {
  const out = await observe(() => posPOST(
    new Request('http://localhost:3000/api/pos/petpooja/00000000-0000-0000-0000-000000000000', { method: 'POST', body: '{}' }),
    { params: Promise.resolve({ provider: 'petpooja', restaurantId: '00000000-0000-0000-0000-000000000000' }) }));
  assertNoSecrets(out, 'POS unknown-restaurant path');
});

test('Razorpay webhook: rejection and its log leak nothing', async () => {
  const body = '{"event":"payment.captured"}';
  const out = await observe(() => razorpayPOST(new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'a'.repeat(64), 'x-razorpay-event-id': 'evt-leak' },
    body,
  })));
  assertNoSecrets(out, 'Razorpay rejection path');
});

test('session: forged cookies return 401 bodies that echo no signing secret or token', async () => {
  const diner = await issueSession({ id: w.dinerA, role: 'diner' });
  const tampered = diner.token.slice(0, -4) + 'AAAA';
  const out = await observe(() => intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent',
    { transcript: 'x', intent: {} }, { cookie: `${SESSION_COOKIE}=${tampered}` })));
  expect(out).toMatch(/401/);
  assertNoSecrets(out, 'forged-session path');
  expect(out).not.toContain(diner.token);
});

test('ratings: a forged cookie response leaks no secret', async () => {
  const out = await observe(() => ratingsPOST(jsonRequest('http://localhost:3000/api/ratings',
    { order_ref_id: w.dinerBOrderDone, rating_score: 5 }, { cookie: `${SESSION_COOKIE}=garbage.token.value` })));
  assertNoSecrets(out, 'ratings forged-session path');
});

test('intent: a server-side failure (budget overflow) leaks no secret in its error or log', async () => {
  const body = {
    transcript: 'x',
    intent: {
      modality: 'DELIVERY', budget_ceiling_inr: 1e12, sla_max_minutes: 30, headcount: 1,
      target_dietary_profiles: [], items_requested: [{ query: 'naan', serving_target: 1 }],
      client_coordinates: { lat: 12.97, lng: 77.64 },
    },
  };
  const cookie = await sessionCookie(w.dinerA, 'diner');
  const out = await observe(async () => intentPOST(jsonRequest('http://localhost:3000/api/delivery/intent', body, { cookie })));
  assertNoSecrets(out, 'intent failure path');
});

test('table open with a wrong signature: error message leaks no secret or stored signature', async () => {
  const stored = (await admin.query('SELECT current_signature_token FROM dining_tables WHERE id = $1', [w.yDining.tableId])).rows[0].current_signature_token;
  const err = await openTableSession(await getPool(), {
    restaurantId: w.rY, tableNumber: w.yDining.tableNumber, signature: 'c'.repeat(32), userId: null,
  }).then(() => '', (e: Error) => `${e.message}\n${e.stack ?? ''}`);
  expect(err).toContain('INVALID_SIGNATURE');
  expect(err).not.toContain(stored);
  assertNoSecrets(err, 'table signature path');
});

test('database: POS credentials are stored encrypted, with no plaintext secret and no plaintext column', async () => {
  const cols = await admin.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'restaurant_nodes' AND column_name = 'pos_credentials'`);
  expect(cols.rows).toHaveLength(0);
  const row = (await admin.query('SELECT ciphertext::text AS ct FROM restaurant_pos_credentials WHERE restaurant_id = $1', [w.rY])).rows[0];
  expect(row.ct).not.toContain(w.yPosSecret);
  expect(row.ct).not.toContain(w.yPosApiKey);
  expect(row.ct).toMatch(/"iv"/);
});

test('database: food_app_login cannot read the stored POS ciphertext at all', async () => {
  const pool = await getPool();
  await expect(pool.query('SELECT ciphertext FROM restaurant_pos_credentials')).rejects.toThrow(/permission denied/);
});
