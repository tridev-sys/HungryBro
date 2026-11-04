// Check 5: 30 concurrent KDS stream connections for one restaurant (app/api/ops/[restaurantId]/kds/stream).
// Each stream must send a snapshot first, then receive a published ticket event. After the
// clients disconnect, Redis subscriber connections must return to baseline. The host wrapper
// (tests/perf/run-sse.sh) samples perf-app memory before, during and after.
import { Redis } from 'ioredis';
import { adminPool, BASE, report, sessionCookie, sleep, STAFF_PHONE_MEGHNA, summarize, userIdByPhone } from './lib/common';
import { kdsChannel } from '@/lib/kds/events';

const STREAMS = Number(process.env.PERF_STREAMS ?? 30);

async function main() {
  const admin = adminPool();
  const staffId = await userIdByPhone(admin, STAFF_PHONE_MEGHNA);
  const rest = (await admin.query('SELECT restaurant_id FROM users WHERE id = $1', [staffId])).rows[0].restaurant_id as string;
  const cookie = await sessionCookie(staffId, 'restaurant_staff');
  const url = `${BASE}/api/ops/${rest}/kds/stream`;
  const redis = new Redis(process.env.REDIS_URL!);
  const clients = async () => Number((await redis.info('clients')).match(/connected_clients:(\d+)/)?.[1] ?? NaN);

  const baselineClients = await clients();
  const controllers = Array.from({ length: STREAMS }, () => new AbortController());
  const openMs: number[] = [];
  const snapshotMs: number[] = [];
  const gotEvent: boolean[] = new Array(STREAMS).fill(false);
  const snapshotFirst: boolean[] = new Array(STREAMS).fill(false);
  const statuses: number[] = new Array(STREAMS).fill(0);
  const errors: string[] = [];

  const readers = controllers.map(async (ctl, i) => {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, { headers: { cookie, accept: 'text/event-stream' }, signal: ctl.signal });
    } catch (e) {
      errors.push(String(e));
      return;
    }
    statuses[i] = res.status;
    openMs.push(performance.now() - t0);
    if (res.status !== 200 || !res.body) return;
    const decoder = new TextDecoder();
    let buf = '';
    let firstEvent: string | null = null;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const m = frame.match(/^data: (.*)$/m);
          if (!m) continue;
          const parsed = JSON.parse(m[1]) as { type: string };
          if (firstEvent === null) {
            firstEvent = parsed.type;
            snapshotFirst[i] = parsed.type === 'snapshot';
            snapshotMs.push(performance.now() - t0);
          }
          if (parsed.type === 'ticket.fired' && (parsed as { ticket?: { marker?: string } }).ticket?.marker === 'perf-sse') {
            gotEvent[i] = true;
          }
        }
        if (gotEvent[i]) break;
      }
    } catch (e) {
      if (!ctl.signal.aborted) errors.push(String(e));
    }
  });

  // Wait until every stream has delivered its snapshot, then publish one event to the channel.
  for (let waited = 0; snapshotMs.length < STREAMS && waited < 20_000; waited += 100) await sleep(100);
  const openClients = await clients();
  await sleep(300);
  await redis.publish(kdsChannel(rest), JSON.stringify({
    type: 'ticket.fired', restaurantId: rest, sessionId: null,
    ticket: { marker: 'perf-sse', restaurantId: rest, station: 'Curry', ticketNumber: 0 },
  }));
  for (let waited = 0; gotEvent.filter(Boolean).length < STREAMS && waited < 10_000; waited += 100) await sleep(100);
  const eventsReceived = gotEvent.filter(Boolean).length;

  // Hold the streams open so memory samples capture the connected state, then disconnect.
  await sleep(Number(process.env.PERF_SSE_HOLD_MS ?? 8000));
  // Disconnect every client, then wait for the server to release its subscribers.
  controllers.forEach((c) => c.abort());
  await Promise.allSettled(readers);
  let afterClients = await clients();
  for (let waited = 0; afterClients > baselineClients && waited < 15_000; waited += 250) {
    await sleep(250);
    afterClients = await clients();
  }

  report('sse-fanout', {
    streams: STREAMS,
    httpStatus: statuses.reduce<Record<string, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {}),
    headersLatencyMs: summarize(openMs),
    snapshotLatencyMs: summarize(snapshotMs),
    snapshotFirstCount: snapshotFirst.filter(Boolean).length,
    eventReceivedCount: eventsReceived,
    redisClients: { baseline: baselineClients, withStreamsOpen: openClients, afterDisconnect: afterClients },
    errors: errors.length,
    errorSample: errors[0] ?? null,
  });
  await redis.quit();
  await admin.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
