import { Room } from 'livekit-client';
import type { VoiceTransport } from './transport';

const LEVEL_POLL_MS = 60;

// Token minting is out of scope for this plan (Open Items 4). The token is a parameter.
export function createLiveKitTransport(): VoiceTransport {
  const room = new Room();
  return {
    async connect(url: string, token: string): Promise<void> {
      await room.connect(url, token);
    },
    async publishMicrophone(): Promise<void> {
      await room.localParticipant.setMicrophoneEnabled(true);
    },
    onLevel(cb: (level: number) => void): () => void {
      const id = setInterval(() => cb(room.localParticipant.audioLevel), LEVEL_POLL_MS);
      return () => clearInterval(id);
    },
    async disconnect(): Promise<void> {
      await room.disconnect();
    },
  };
}
