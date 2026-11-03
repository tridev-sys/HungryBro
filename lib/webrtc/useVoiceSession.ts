'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createLiveKitTransport } from './livekit';
import { createVoiceSession, type VoiceSession } from './session';
import type { VoiceTransport } from './transport';

export function useVoiceSession(createTransport: () => VoiceTransport = createLiveKitTransport): VoiceSession {
  const ref = useRef<VoiceSession | null>(null);
  if (ref.current === null) {
    ref.current = createVoiceSession(createTransport());
  }
  const session = ref.current;

  // Re-render whenever the session notifies. The snapshot is a string so it compares by value.
  useSyncExternalStore(
    session.subscribe,
    () => `${session.status}|${session.level}|${session.error ?? ''}`,
    () => `${session.status}|${session.level}|${session.error ?? ''}`,
  );

  useEffect(() => {
    return () => {
      void session.stop();
    };
  }, [session]);

  return session;
}
