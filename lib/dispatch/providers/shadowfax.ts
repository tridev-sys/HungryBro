import { z } from 'zod';
import { assertSandbox, normalizeStatus, providerRequest } from '../http';
import type { DispatchAdapter, DispatchTask, DispatchTaskRequest, SandboxConfig } from '../types';

// ASSUMED endpoints and field names. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING.
export function toCreateTaskBody(req: DispatchTaskRequest) {
  return {
    external_id: req.deliveryId,
    pickup: { latitude: req.pickup.lat, longitude: req.pickup.lng, address: req.pickup.address },
    drop: { latitude: req.dropoff.lat, longitude: req.dropoff.lng, address: req.dropoff.address },
    ready_at: req.readyAt,
    order_value: req.orderValueInr,
  };
}

const taskSchema = z.object({
  id: z.string().min(1),
  state: z.string(),
  eta_minutes: z.number().nullable().optional(),
});

export function fromCreateTaskResponse(json: unknown): Omit<DispatchTask, 'provider'> {
  const t = taskSchema.parse(json);
  return { providerTaskId: t.id, status: normalizeStatus(t.state), etaMinutes: t.eta_minutes ?? null };
}

export class ShadowfaxAdapter implements DispatchAdapter {
  readonly provider = 'shadowfax' as const;
  constructor(private readonly cfg: SandboxConfig) {
    assertSandbox(cfg);
  }

  async createTask(req: DispatchTaskRequest): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'shadowfax', 'POST', '/v1/tasks', toCreateTaskBody(req));
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async getTask(id: string): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'shadowfax', 'GET', `/v1/tasks/${encodeURIComponent(id)}`);
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async cancelTask(id: string): Promise<void> {
    await providerRequest(this.cfg, 'shadowfax', 'POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`);
  }
}
