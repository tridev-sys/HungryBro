// Checks 1 and 7: 50 concurrent POST /api/delivery/intent, then Postgres connection count.
// Run: sh -c '. tests/perf/env.sh && perf_node npx tsx tests/perf/intent-burst.ts'
import { adminPool, BASE, connCount, DINER_PHONE, report, sessionCookie, sleep, summarize, userIdByPhone } from './lib/common';

const CONCURRENT = Number(process.env.PERF_CONCURRENT ?? 50);

function body(i: number) {
  return {
    transcript: `perf burst ${i}: chicken biryani for one`,
    intent: {
      modality: 'DELIVERY',
      budget_ceiling_inr: 1000,
      sla_max_minutes: 45,
      headcount: 1,
      target_dietary_profiles: [],
      items_requested: [{ query: 'Chicken Biryani', serving_target: 1 }],
      client_coordinates: { lat: 12.9719, lng: 77.6408 },
    },
  };
}

async function main() {
  const admin = adminPool();
  const cookie = await sessionCookie(await userIdByPhone(admin, DINER_PHONE), 'diner');
  const before = await connCount(admin, 'food_app_login');

  let peak = before;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      peak = Math.max(peak, await connCount(admin, 'food_app_login'));
      await sleep(50);
    }
  })();

  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, async (_, i) => {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}/api/delivery/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(body(i)),
        });
        const text = await res.text();
        return { status: res.status, ms: performance.now() - t0, text };
      } catch (err) {
        return { status: 0, ms: performance.now() - t0, text: String(err) };
      }
    }),
  );
  polling = false;
  await poller;

  await sleep(1000);
  const after = await connCount(admin, 'food_app_login');

  const ok = results.filter((r) => r.status === 201);
  const clean4xx = results.filter((r) => r.status >= 400 && r.status < 500);
  const server5xx = results.filter((r) => r.status >= 500);
  const netErr = results.filter((r) => r.status === 0);
  const statusCounts: Record<string, number> = {};
  for (const r of results) statusCounts[String(r.status)] = (statusCounts[String(r.status)] ?? 0) + 1;
  const sample = results.find((r) => r.status >= 400)?.text.slice(0, 200);

  report('intent-burst', {
    concurrent: CONCURRENT,
    statusCounts,
    latencyMs: summarize(results.map((r) => r.ms)),
    latency201Ms: summarize(ok.map((r) => r.ms)),
    errors: results.length - ok.length,
    clean4xx: clean4xx.length,
    server5xx: server5xx.length,
    networkErrors: netErr.length,
    sampleNon201: sample ?? null,
    appLoginConnections: { before, peakDuringBurst: peak, afterSettle: after },
  });
  await admin.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
