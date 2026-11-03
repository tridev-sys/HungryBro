import { randomBytes } from 'node:crypto';
import type { DispatchAdapter, DispatchTask, DispatchTaskRequest } from './types';

// Sandbox fake of the Plan 06 DispatchAdapter. In-memory only; no network calls.
// Live adapters come only from Plan 06's createDispatchAdapter.

export interface SandboxDispatchTask extends DispatchTask {
  rider: { name: string; vehicle: string };
  bagTempC: number;
}

export interface SandboxDispatchAdapter extends DispatchAdapter {
  readonly isSandbox: true;
  getTask(providerTaskId: string): Promise<SandboxDispatchTask>;
}

interface Entry {
  task: DispatchTask;
  requestedAtMs: number;
}

// Module-level so every adapter instance in a process sees the same sandbox tasks.
const tasks = new Map<string, Entry>();

const SANDBOX_ETA_MINUTES = 12;

export function createSandboxDispatch(): SandboxDispatchAdapter {
  return {
    provider: 'shadowfax',
    isSandbox: true,
    async createTask(_req: DispatchTaskRequest): Promise<DispatchTask> {
      const task: DispatchTask = {
        provider: 'shadowfax',
        providerTaskId: `sbx-${randomBytes(4).toString('hex')}`,
        status: 'assigned',
        etaMinutes: SANDBOX_ETA_MINUTES,
      };
      tasks.set(task.providerTaskId, { task, requestedAtMs: Date.now() });
      return { ...task };
    },
    async getTask(providerTaskId: string): Promise<SandboxDispatchTask> {
      const entry = tasks.get(providerTaskId);
      if (!entry) throw new Error('unknown sandbox task');
      const elapsedMinutes = (Date.now() - entry.requestedAtMs) / 60_000;
      return {
        ...entry.task,
        etaMinutes: Math.max(1, SANDBOX_ETA_MINUTES - Math.floor(elapsedMinutes)),
        rider: { name: 'Sandbox Rider', vehicle: 'EV_BIKE' },
        bagTempC: 68,
      };
    },
    async cancelTask(providerTaskId: string): Promise<void> {
      const entry = tasks.get(providerTaskId);
      if (!entry) throw new Error('unknown sandbox task');
      entry.task = { ...entry.task, status: 'cancelled' };
    },
  };
}

export function assertSandboxDispatchMode(): void {
  if (process.env.DISPATCH_MODE === 'live') {
    throw new Error('DISPATCH_MODE=live is not enabled in Plan 06');
  }
}
