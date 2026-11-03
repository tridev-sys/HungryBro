import type { VoiceTransport } from './transport';

export type SessionStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface VoiceSession {
  readonly status: SessionStatus;
  readonly level: number;
  readonly error: string | null;
  start(url: string, token: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: () => void): () => void;
}

export function createVoiceSession(transport: VoiceTransport): VoiceSession {
  let status: SessionStatus = 'idle';
  let level = 0;
  let error: string | null = null;
  let unsubscribeLevel: (() => void) | null = null;
  const subscribers = new Set<() => void>();

  const notify = () => {
    for (const cb of subscribers) cb();
  };

  return {
    get status() {
      return status;
    },
    get level() {
      return level;
    },
    get error() {
      return error;
    },
    async start(url: string, token: string): Promise<void> {
      error = null;
      status = 'connecting';
      notify();
      try {
        await transport.connect(url, token);
        unsubscribeLevel = transport.onLevel((next) => {
          level = next;
          notify();
        });
        await transport.publishMicrophone();
        status = 'live';
        notify();
      } catch (err) {
        status = 'error';
        error = err instanceof Error ? err.message : String(err);
        notify();
      }
    },
    async stop(): Promise<void> {
      unsubscribeLevel?.();
      unsubscribeLevel = null;
      try {
        await transport.disconnect();
      } finally {
        status = 'idle';
        level = 0;
        notify();
      }
    },
    subscribe(cb: () => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
