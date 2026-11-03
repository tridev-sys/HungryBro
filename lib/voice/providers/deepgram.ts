import 'server-only';
import type { AudioChunk, SttProvider, SttResult } from '../types';

// VERIFY against live Deepgram docs before the first real call (Open Items 1).
export const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true';

export function createDeepgramStt(opts: { apiKey: string; fetchImpl?: typeof fetch }): SttProvider {
  const { apiKey } = opts;
  return {
    name: 'deepgram',
    async transcribe(audio: AudioChunk): Promise<SttResult> {
      const doFetch = opts.fetchImpl ?? fetch;
      const res = await doFetch(DEEPGRAM_LISTEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'audio/l16;rate=16000;channels=1',
        },
        body: audio.pcm16 as BodyInit,
      });
      if (!res.ok) {
        throw new Error(`deepgram request failed with status ${res.status}`);
      }
      const json = (await res.json()) as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }> };
      };
      const alt = json.results?.channels?.[0]?.alternatives?.[0];
      return { text: alt?.transcript ?? '', language: 'en', confidence: alt?.confidence ?? 0 };
    },
  };
}
