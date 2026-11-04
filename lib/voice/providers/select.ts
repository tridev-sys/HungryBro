import 'server-only';
import type { SttProvider, TtsProvider, TranslationProvider } from '../types';
import { FakeStt, FakeTts, FakeTranslation } from '../fakes';
import { createDeepgramStt } from './deepgram';
import { createCartesiaTts, cartesiaVoiceIds } from './cartesia';
import { createSarvamTranslation } from './sarvam';

export interface SpeechProviders {
  stt: SttProvider;
  tts: TtsProvider;
  translation: TranslationProvider;
}

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function selectSpeechProviders(
  env: Record<string, string | undefined>,
  deps: { fetchImpl?: typeof fetch } = {},
): SpeechProviders {
  const stt = present(env.DEEPGRAM_API_KEY)
    ? createDeepgramStt({ apiKey: env.DEEPGRAM_API_KEY })
    : new FakeStt({ text: '' });
  const voices = cartesiaVoiceIds(env);
  const tts = present(env.CARTESIA_API_KEY)
    ? createCartesiaTts({
        apiKey: env.CARTESIA_API_KEY,
        fetchImpl: deps.fetchImpl,
        voiceId: voices.primary,
        fallbackVoiceId: voices.fallback,
      })
    : new FakeTts();
  const translation = present(env.SARVAM_API_KEY)
    ? createSarvamTranslation({ apiKey: env.SARVAM_API_KEY, fetchImpl: deps.fetchImpl })
    : new FakeTranslation();
  return { stt, tts, translation };
}
