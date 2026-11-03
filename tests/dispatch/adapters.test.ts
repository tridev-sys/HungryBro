import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ShadowfaxAdapter, toCreateTaskBody as sfBody } from '@/lib/dispatch/providers/shadowfax';
import { RapidoAdapter } from '@/lib/dispatch/providers/rapido';
import { DunzoAdapter } from '@/lib/dispatch/providers/dunzo';
import { createDispatchAdapter } from '@/lib/dispatch/factory';
import { FakeDispatchAdapter } from '@/lib/dispatch/fake';
import type { DispatchTaskRequest } from '@/lib/dispatch/types';

const fx = (p: string) => JSON.parse(readFileSync(path.join(__dirname, '../fixtures/3pl', `${p}-create-task.json`), 'utf8'));
const req: DispatchTaskRequest = {
  deliveryId: 'd-1',
  pickup: { lat: 12.9352, lng: 77.6245, address: 'Koramangala 5th Block' },
  dropoff: { lat: 12.9116, lng: 77.6389, address: 'HSR Sector 2' },
  readyAt: '2026-11-03T12:20:00.000Z', orderValueInr: 698,
};

function fakeFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch;
  return { f, calls };
}
const sandbox = (f: typeof fetch) => ({ mode: 'sandbox' as const, baseUrl: 'https://sandbox.shadowfax.test', apiKey: 'k', fetchImpl: f });

test('shadowfax maps the request body and the response into DispatchTask', async () => {
  const { f, calls } = fakeFetch(fx('shadowfax'));
  const task = await new ShadowfaxAdapter(sandbox(f)).createTask(req);
  expect(task).toEqual({ provider: 'shadowfax', providerTaskId: 'shadowfax-task-001', status: 'assigned', etaMinutes: 14 });
  expect(calls[0].url).toBe('https://sandbox.shadowfax.test/v1/tasks');
  expect(JSON.parse(String(calls[0].init.body))).toEqual(sfBody(req));
  expect(sfBody(req).pickup).toMatchObject({ latitude: 12.9352, longitude: 77.6245 });
});

test('rapido maps its different response shape', async () => {
  const { f } = fakeFetch(fx('rapido'));
  const task = await new RapidoAdapter({ ...sandbox(f), baseUrl: 'https://sandbox.rapido.test' }).createTask(req);
  expect(task).toMatchObject({ provider: 'rapido', providerTaskId: 'rapido-task-001', status: 'assigned', etaMinutes: 14 });
});

test('dunzo maps its nested response shape', async () => {
  const { f } = fakeFetch(fx('dunzo'));
  const task = await new DunzoAdapter({ ...sandbox(f), baseUrl: 'https://sandbox.dunzo.test' }).createTask(req);
  expect(task).toMatchObject({ provider: 'dunzo', providerTaskId: 'dunzo-task-001', status: 'assigned', etaMinutes: 14 });
});

test('live mode is refused in this plan', () => {
  expect(() => createDispatchAdapter('shadowfax', { mode: 'live', baseUrl: 'https://x.test', apiKey: 'k' }))
    .toThrow(/not enabled in Plan 06/);
});

test('fake adapter round-trips a task and can simulate a failed create', async () => {
  const fake = new FakeDispatchAdapter('rapido');
  const t = await fake.createTask(req);
  expect(await fake.getTask(t.providerTaskId)).toMatchObject({ status: 'created' });
  await fake.cancelTask(t.providerTaskId);
  expect((await fake.getTask(t.providerTaskId)).status).toBe('cancelled');
  fake.failNextCreate(new Error('3pl down'));
  await expect(fake.createTask(req)).rejects.toThrow('3pl down');
});
