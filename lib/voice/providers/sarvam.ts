import 'server-only';
import type { LangCode, TranslationProvider } from '../types';

// VERIFY against live Sarvam docs before the first real call (Open Items 1).
export const SARVAM_TRANSLATE_URL = 'https://api.sarvam.ai/translate';
export const SARVAM_MODEL = 'mayura:v1';

// Language codes are unverified until checked against Sarvam docs (Open Items 1).
function sarvamCode(lang: LangCode): string {
  return lang === 'en' ? 'en-IN' : 'hi-IN';
}

export function createSarvamTranslation(opts: { apiKey: string; fetchImpl?: typeof fetch }): TranslationProvider {
  const { apiKey } = opts;
  return {
    name: 'sarvam',
    async translate(text: string, from: LangCode, to: LangCode): Promise<string> {
      const doFetch = opts.fetchImpl ?? fetch;
      const res = await doFetch(SARVAM_TRANSLATE_URL, {
        method: 'POST',
        headers: {
          'api-subscription-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          source_language_code: sarvamCode(from),
          target_language_code: sarvamCode(to),
          model: SARVAM_MODEL,
        }),
      });
      if (!res.ok) {
        throw new Error(`sarvam request failed with status ${res.status}`);
      }
      const json = (await res.json()) as { translated_text?: string };
      return json.translated_text ?? '';
    },
  };
}
