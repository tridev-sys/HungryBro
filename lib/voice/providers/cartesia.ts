import 'server-only';
import type { ReplyLanguage, TtsProvider } from '../types';

// VERIFY against live Cartesia docs before the first real call (Open Items 1).
export const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes';
// Verified against https://docs.cartesia.ai/api-reference/tts/bytes (2026-11-04): the only enum value is 2026-08-14.
export const CARTESIA_VERSION_HEADER = '2026-08-14';
// Placeholder: set CARTESIA_VOICE_ID to a real voice id. Calls fail visibly until then.
export const CARTESIA_DEFAULT_VOICE_ID = 'REPLACE_WITH_CARTESIA_VOICE_ID';

export function createCartesiaTts(opts: { apiKey: string; fetchImpl?: typeof fetch; voiceId?: string }): TtsProvider {
  const { apiKey } = opts;
  const voiceId = opts.voiceId ?? CARTESIA_DEFAULT_VOICE_ID;
  return {
    name: 'cartesia',
    async *synthesize(text: string, _language: ReplyLanguage): AsyncIterable<Uint8Array> {
      const doFetch = opts.fetchImpl ?? fetch;
      const res = await doFetch(CARTESIA_TTS_URL, {
        method: 'POST',
        headers: {
          // tts/bytes uses HTTP bearer auth per the official spec (checked 2026-11-04).
          Authorization: `Bearer ${apiKey}`,
          'Cartesia-Version': CARTESIA_VERSION_HEADER,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-3',
          transcript: text,
          voice: { mode: 'id', id: voiceId },
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
          language: 'en',
        }),
      });
      if (!res.ok) {
        throw new Error(`cartesia request failed with status ${res.status}`);
      }
      if (!res.body) {
        return;
      }
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
