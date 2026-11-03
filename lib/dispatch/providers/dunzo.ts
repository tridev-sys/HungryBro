import { z } from 'zod';
import { assertSandbox, normalizeStatus, providerRequest } from '../http';
import type { DispatchAdapter, DispatchTask, DispatchTaskRequest, SandboxConfig } from '../types';

// ASSUMED endpoints and field names. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING.
export function toCreateTaskBody(req: DispatchTaskRequest) {
  return {
    request_id: req.deliveryId,
    pickup_details: { address: { lat: req.pickup.lat, lng: req.pickup.lng, street_address: req.pickup.address } },
    dropoff_details: { address: { lat: req.dropoff.lat, lng: req.dropoff.lng, street_address: req.dropoff.address } },
    ready_at: req.readyAt,
    order_value: req.orderValueInr,
  };
}

const responseSchema = z.object({
  task: z.object({
    id: z.string().min(1),
    state: z.string(),
    eta: z.number().nullable().optional(),
  }),
});

export function fromCreateTaskResponse(json: unknown): Omit<DispatchTask, 'provider'> {
  const { task } = responseSchema.parse(json);
  return { providerTaskId: task.id, status: normalizeStatus(task.state), etaMinutes: task.eta ?? null };
}

export class DunzoAdapter implements DispatchAdapter {
  readonly provider = 'dunzo' as const;
  constructor(private readonly cfg: SandboxConfig) {
    assertSandbox(cfg);
  }

  async createTask(req: DispatchTaskRequest): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'dunzo', 'POST', '/v1/tasks', toCreateTaskBody(req));
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async getTask(id: string): Promise<DispatchTask> {
    const json = await providerRequest(this.cfg, 'dunzo', 'GET', `/v1/tasks/${encodeURIComponent(id)}`);
    return { provider: this.provider, ...fromCreateTaskResponse(json) };
  }

  async cancelTask(id: string): Promise<void> {
    await providerRequest(this.cfg, 'dunzo', 'POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`);
  }
}
