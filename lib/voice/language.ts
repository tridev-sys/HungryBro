import type { LangCode, ReplyLanguage, TranslationProvider } from './types';

export const HINGLISH_MARKERS: readonly string[] = [
  'aur', 'ek', 'chahiye', 'hai', 'hain', 'mujhe', 'bhaiya', 'kya', 'nahi',
  'dikhao', 'kitna', 'mein', 'wala', 'bhai', 'teen',
];

const DEVANAGARI = /[ऀ-ॿ]/;
const MARKER_SET = new Set(HINGLISH_MARKERS);

export function detectLanguage(text: string): LangCode {
  if (DEVANAGARI.test(text)) return 'hi';
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const distinct = new Set(tokens.filter((t) => MARKER_SET.has(t)));
  return distinct.size >= 2 ? 'hi-en' : 'en';
}

export function replyLanguageFor(lang: LangCode): ReplyLanguage {
  return lang === 'en' ? 'en' : 'hi-en';
}

export async function translateForLlm(
  translator: TranslationProvider,
  text: string,
  lang: LangCode,
): Promise<string> {
  if (lang === 'en') return text;
  return translator.translate(text, lang, 'en');
}
