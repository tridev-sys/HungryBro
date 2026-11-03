import type { DispatchAdapter, DispatchTask, DispatchTaskRequest, ThreePlProvider } from './types';

// In-memory 3PL for tests and local development. Never touches the network.
export class FakeDispatchAdapter implements DispatchAdapter {
  readonly provider: ThreePlProvider;
  private readonly tasks = new Map<string, DispatchTask>();
  private seq = 0;
  private nextError: Error | undefined;

  constructor(provider: ThreePlProvider) {
    this.provider = provider;
  }

  failNextCreate(err: Error = new Error('simulated 3PL failure')): void {
    this.nextError = err;
  }

  async createTask(_req: DispatchTaskRequest): Promise<DispatchTask> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = undefined;
      throw err;
    }
    this.seq += 1;
    const task: DispatchTask = {
      provider: this.provider,
      providerTaskId: `fake-${this.provider}-${this.seq}`,
      status: 'created',
      etaMinutes: null,
    };
    this.tasks.set(task.providerTaskId, task);
    return { ...task };
  }

  async getTask(providerTaskId: string): Promise<DispatchTask> {
    const task = this.tasks.get(providerTaskId);
    if (!task) throw new Error(`unknown task ${providerTaskId}`);
    return { ...task };
  }

  async cancelTask(providerTaskId: string): Promise<void> {
    const task = this.tasks.get(providerTaskId);
    if (!task) throw new Error(`unknown task ${providerTaskId}`);
    task.status = 'cancelled';
  }
}
