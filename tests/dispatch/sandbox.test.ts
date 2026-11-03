import { createSandboxDispatch, assertSandboxDispatchMode } from '@/lib/dispatch/sandbox';
import type { DispatchTaskRequest } from '@/lib/dispatch/types';

const req: DispatchTaskRequest = {
  deliveryId: 'a1',
  pickup: { lat: 12.97, lng: 77.64, address: 'Meghna Foods' },
  dropoff: { lat: 12.98, lng: 77.65, address: 'Indiranagar' },
  readyAt: '2026-11-03T12:20:00.000Z', orderValueInr: 698,
};

test('sandbox task returns a tracking id; status shows a 68 C hot bag', async () => {
  const d = createSandboxDispatch();
  const t = await d.createTask(req);
  expect(t.providerTaskId).toMatch(/^sbx-[0-9a-f]{8}$/);
  const s = await d.getTask(t.providerTaskId);
  expect(s).toMatchObject({ status: 'assigned', bagTempC: 68, rider: { name: 'Sandbox Rider', vehicle: 'EV_BIKE' } });
  expect(s.etaMinutes).toBeGreaterThanOrEqual(1);
});

test('sandbox is flagged and unknown task ids throw', async () => {
  const d = createSandboxDispatch();
  expect(d.isSandbox).toBe(true);
  await expect(d.getTask('sbx-00000000')).rejects.toThrow(/unknown/i);
});

test('live dispatch is refused in v1 (Review Focus 5)', () => {
  const prev = process.env.DISPATCH_MODE;
  process.env.DISPATCH_MODE = 'live';
  try {
    expect(() => assertSandboxDispatchMode()).toThrow(/Plan 06/);
  } finally {
    process.env.DISPATCH_MODE = prev;
  }
});
