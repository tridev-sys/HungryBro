import { createSarvamTranslation } from '@/lib/voice/providers/sarvam';
import { selectSpeechProviders } from '@/lib/voice/providers/select';
import { vi } from 'vitest';

function jsonFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

test('Sarvam adapter maps hi-en to hi-IN source and en-IN target', async () => {
  const fetchImpl = jsonFetch({ translated_text: 'two naan please' });
  const t = createSarvamTranslation({ apiKey: 'sv-test-key', fetchImpl: fetchImpl as unknown as typeof fetch });
  expect(await t.translate('do naan chahiye', 'hi-en', 'en')).toBe('two naan please');
  const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toMatchObject({ source_language_code: 'hi-IN', target_language_code: 'en-IN' });
});

test('selectSpeechProviders returns fakes and makes no network call without keys', () => {
  const fetchImpl = vi.fn();
  const p = selectSpeechProviders({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
  expect([p.stt.name, p.tts.name, p.translation.name]).toEqual(['fake', 'fake', 'fake']);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('selectSpeechProviders uses a real adapter only for a present key', () => {
  const p = selectSpeechProviders({ DEEPGRAM_API_KEY: 'k' });
  expect(p.stt.name).toBe('deepgram');
  expect(p.tts.name).toBe('fake');
});
