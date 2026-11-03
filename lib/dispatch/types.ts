import type { LatLng } from '../../types/food-os';

// The 3PL dispatch interface. Plan 02 adopts this shape (shared decision 5).

export type ThreePlProvider = 'shadowfax' | 'rapido' | 'dunzo';
export type DispatchStatus = 'created' | 'assigned' | 'picked_up' | 'delivered' | 'cancelled' | 'failed';

export interface DispatchPoint extends LatLng {
  address: string;
}

export interface DispatchTaskRequest {
  deliveryId: string;
  pickup: DispatchPoint;
  dropoff: DispatchPoint;
  readyAt: string;
  orderValueInr: number;
}

export interface DispatchTask {
  provider: ThreePlProvider;
  providerTaskId: string;
  status: DispatchStatus;
  etaMinutes: number | null;
}

export interface DispatchAdapter {
  readonly provider: ThreePlProvider;
  createTask(req: DispatchTaskRequest): Promise<DispatchTask>;
  getTask(providerTaskId: string): Promise<DispatchTask>;
  cancelTask(providerTaskId: string): Promise<void>;
}

export interface SandboxConfig {
  mode: 'sandbox' | 'live';
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}
