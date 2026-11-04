import 'server-only';
import type { ReplyLanguage, TtsProvider } from '../types';

// VERIFY against live Cartesia docs before the first real call (Open Items 1).
export const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes';
// Verified against https://docs.cartesia.ai/api-reference/tts/bytes (2026-11-04): the only enum value is 2026-08-14.
export const CARTESIA_VERSION_HEADER = '2026-08-14';
// Owner-set voices (2026-11-04). Override with CARTESIA_VOICE_ID and CARTESIA_VOICE_ID_FALLBACK.
export const CARTESIA_DEFAULT_VOICE_ID = '7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8';
export const CARTESIA_FALLBACK_VOICE_ID = 'f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d';

export function cartesiaVoiceIds(env: Record<string, string | undefined>): { primary: string; fallback: string } {
  return {
    primary: env.CARTESIA_VOICE_ID || CARTESIA_DEFAULT_VOICE_ID,
    fallback: env.CARTESIA_VOICE_ID_FALLBACK || CARTESIA_FALLBACK_VOICE_ID,
  };
}

export function createCartesiaTts(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  voiceId?: string;
  fallbackVoiceId?: string;
}): TtsProvider {
  const { apiKey } = opts;
  const voiceId = opts.voiceId ?? CARTESIA_DEFAULT_VOICE_ID;
  const fallbackVoiceId = opts.fallbackVoiceId ?? CARTESIA_FALLBACK_VOICE_ID;

  async function request(text: string, voice: string): Promise<Response> {
    const doFetch = opts.fetchImpl ?? fetch;
    return doFetch(CARTESIA_TTS_URL, {
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
        voice: { mode: 'id', id: voice },
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
        language: 'en',
      }),
    });
  }

  return {
    name: 'cartesia',
    async *synthesize(text: string, _language: ReplyLanguage): AsyncIterable<Uint8Array> {
      let res = await request(text, voiceId);
      // A 404 means the primary voice ID is not found. Retry once with the fallback voice. Other errors are not retried.
      if (res.status === 404 && fallbackVoiceId && fallbackVoiceId !== voiceId) {
        res = await request(text, fallbackVoiceId);
      }
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
