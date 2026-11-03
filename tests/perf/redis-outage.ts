// Check 6: intent requests while Redis is down. The host wrapper (redis-outage.sh) stops the
// throwaway perf-redis container before this runs. Expect a clean 5xx/503 well under 5 s, not a hang.
import { adminPool, BASE, DINER_PHONE, report, sessionCookie, summarize, userIdByPhone } from './lib/common';

function body(i: number) {
  return {
    transcript: `perf redis outage ${i}`,
    intent: { modality: 'DELIVERY', budget_ceiling_inr: 1000, sla_max_minutes: 45, headcount: 1,
      target_dietary_profiles: [], items_requested: [{ query: 'Chicken Biryani', serving_target: 1 }],
      client_coordinates: { lat: 12.9719, lng: 77.6408 } },
  };
}

async function one(cookie: string, i: number) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/delivery/intent`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body(i)), signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - t0, sample: text.slice(0, 160) };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, sample: String((e as Error).name ?? e) };
  }
}

async function main() {
  const admin = adminPool();
  const cookie = await sessionCookie(await userIdByPhone(admin, DINER_PHONE), 'diner');
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(await one(cookie, i));
  const par = await Promise.all(Array.from({ length: 10 }, (_, i) => one(cookie, 10 + i)));
  const all = [...seq, ...par];
  const statusCounts: Record<string, number> = {};
  for (const r of all) statusCounts[String(r.status)] = (statusCounts[String(r.status)] ?? 0) + 1;
  report('redis-outage', {
    requests: all.length,
    statusCounts,
    latencyMs: summarize(all.map((r) => r.ms)),
    maxMsOverFiveSeconds: all.filter((r) => r.ms > 5000).length,
    sampleResponse: all.find((r) => r.status !== 201)?.sample ?? null,
  });
  await admin.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
