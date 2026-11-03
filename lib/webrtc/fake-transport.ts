import type { VoiceTransport } from './transport';

export class FakeTransport implements VoiceTransport {
  connects = 0;
  disconnects = 0;
  private readonly levelCallbacks = new Set<(level: number) => void>();
  private pendingConnectError: string | null = null;

  failNextConnect(message: string): void {
    this.pendingConnectError = message;
  }

  async connect(_url: string, _token: string): Promise<void> {
    this.connects++;
    if (this.pendingConnectError !== null) {
      const message = this.pendingConnectError;
      this.pendingConnectError = null;
      throw new Error(message);
    }
  }

  async publishMicrophone(): Promise<void> {
    // No-op: the fake has no microphone.
  }

  onLevel(cb: (level: number) => void): () => void {
    this.levelCallbacks.add(cb);
    return () => {
      this.levelCallbacks.delete(cb);
    };
  }

  emitLevel(level: number): void {
    for (const cb of this.levelCallbacks) cb(level);
  }

  async disconnect(): Promise<void> {
    this.disconnects++;
  }
}
