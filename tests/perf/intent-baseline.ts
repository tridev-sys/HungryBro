// Single-request and 10-concurrency baseline for the intent route (SANDBOX_BID_DELAY_MS as set on perf-app).
import { adminPool, BASE, DINER_PHONE, report, sessionCookie, summarize, userIdByPhone } from './lib/common';

async function once(cookie: string, i: number): Promise<{ status: number; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/delivery/intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      transcript: `perf baseline ${i}`,
      intent: { modality: 'DELIVERY', budget_ceiling_inr: 1000, sla_max_minutes: 45, headcount: 1,
        target_dietary_profiles: [], items_requested: [{ query: 'Chicken Biryani', serving_target: 1 }],
        client_coordinates: { lat: 12.9719, lng: 77.6408 } },
    }),
  });
  await res.text();
  return { status: res.status, ms: performance.now() - t0 };
}

async function main() {
  const admin = adminPool();
  const cookie = await sessionCookie(await userIdByPhone(admin, DINER_PHONE), 'diner');
  const single = [];
  for (let i = 0; i < 5; i++) single.push(await once(cookie, i));
  const ten = await Promise.all(Array.from({ length: 10 }, (_, i) => once(cookie, 100 + i)));
  report('intent-baseline', {
    sequential5: summarize(single.map((r) => r.ms)),
    concurrent10: summarize(ten.map((r) => r.ms)),
    statuses: [...single, ...ten].reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
  });
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
