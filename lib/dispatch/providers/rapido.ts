import { z } from 'zod';
import { assertSandbox, normalizeStatus, providerRequest } from '../http';
import type { DispatchAdapter, DispatchTask, DispatchTaskRequest, SandboxConfig } from '../types';

// ASSUMED endpoints and field names. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING.
export function toCreateTaskBody(req: DispatchTaskRequest) {
  return {
    order_ref: req.deliveryId,
    pickup_point: { lat: req.pickup.lat, lng: req.pickup.lng, address: req.pickup.address },
    drop_point: { lat: req.dropoff.lat, lng: req.dropoff.lng, address: req.dropoff.address },
    ready_by: req.readyAt,
    order_value_inr: req.orderValueInr,
  };
}

const taskSchema = z.object({
  task_id: z.string().min(1),
  status: z.string(),
  eta_minutes: z.number().nullable().optional(),
});

export function fromCreateTaskResponse(json: unknown): Omit<DispatchTask, 'provider'> {
  const t = taskSchema.parse(json);
  return { providerTaskId: t.task_id, status: normalizeStatus(t.status), etaMinutes: t.eta_minutes ?? null };
}

export class RapidoAdapter implements DispatchAdapter {
  readonly provider = 'rapido' as const;
  constructor(private readonly cfg: SandboxConfig) {
    assertSandbox(cfg);
  }

  async createTask(req: DispatchTaskRequest): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'rapido', 'POST', '/v1/tasks', toCreateTaskBody(req));
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async getTask(id: string): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'rapido', 'GET', `/v1/tasks/${encodeURIComponent(id)}`);
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async cancelTask(id: string): Promise<void> {
    await providerRequest(this.cfg, 'rapido', 'POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`);
  }
}
