// Check 4: rate limiting.
// Part A: HTTP token bucket on public routes (plan 07: per IP 120 capacity / 2 per s; per session
//         60 / 1 per s; 429 with Retry-After). Burst 300 GETs to /api/health, then recheck after the window.
// Part B: the per-phone OTP limit (3 challenges per hour, migration 004), the only limit implemented in the app today.
import { getPool } from '@/lib/db/client';
import { requestOtp } from '@/lib/auth/otp';
import { selectOtpProvider } from '@/lib/auth/otp-providers';
import { adminPool, BASE, report, sleep } from './lib/common';
import type pg from 'pg';

async function main() {
  const burst = Number(process.env.PERF_RATE_BURST ?? 300);
  const statuses: Record<string, number> = {};
  let retryAfter: string | null = null;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: burst }, async () => {
    const res = await fetch(`${BASE}/api/health`);
    await res.text();
    statuses[String(res.status)] = (statuses[String(res.status)] ?? 0) + 1;
    if (res.status === 429) retryAfter = res.headers.get('retry-after');
  }));
  const burstMs = Math.round(performance.now() - t0);
  await sleep(2500);
  const recover = await fetch(`${BASE}/api/health`);
  await recover.text();

  // Part B
  const phone = `+91 9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const provider = selectOtpProvider({ ...process.env, OTP_PROVIDER: 'dev' });
  const pool = await getPool();
  const otp: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await requestOtp(pool as pg.Pool, provider, phone);
    otp.push(r.ok ? 'ok' : r.reason);
  }
  const admin = adminPool();
  await admin.query('DELETE FROM otp_challenges WHERE phone_e164 = $1', [phone.replace(/\s/g, '')]);
  await admin.end();

  report('rate-limit', {
    httpBurst: { requests: burst, statusCounts: statuses, retryAfterHeader: retryAfter, burstMs },
    afterWindowStatus: recover.status,
    otpPerPhone4Requests: otp,
  });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
