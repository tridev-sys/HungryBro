import { selectSpeechProviders } from '@/lib/voice/providers/select';
import {
  CARTESIA_DEFAULT_VOICE_ID,
  CARTESIA_FALLBACK_VOICE_ID,
  cartesiaVoiceIds,
  createCartesiaTts,
} from '@/lib/voice/providers/cartesia';

const PRIMARY = '7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8';
const FALLBACK = 'f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d';

// Every request is recorded and answered by the fake. Cartesia is never called.
function fakeCartesia(statuses: number[]) {
  const calls: { url: string; body: { model_id: string; voice: { id: string } } }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const status = statuses.shift() ?? 200;
    return new Response(new Uint8Array([1, 2, 3, 4]), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function drain(iter: AsyncIterable<Uint8Array>) {
  for await (const _chunk of iter) { /* drain */ }
}

test('the default voice is the owner-set primary, with the owner-set fallback in config', () => {
  expect(CARTESIA_DEFAULT_VOICE_ID).toBe(PRIMARY);
  expect(CARTESIA_FALLBACK_VOICE_ID).toBe(FALLBACK);
  expect(cartesiaVoiceIds({})).toEqual({ primary: PRIMARY, fallback: FALLBACK });
});

test('CARTESIA_VOICE_ID and CARTESIA_VOICE_ID_FALLBACK override the defaults from env', () => {
  expect(cartesiaVoiceIds({ CARTESIA_VOICE_ID: 'voice-a', CARTESIA_VOICE_ID_FALLBACK: 'voice-b' }))
    .toEqual({ primary: 'voice-a', fallback: 'voice-b' });
  expect(cartesiaVoiceIds({ CARTESIA_VOICE_ID: '', CARTESIA_VOICE_ID_FALLBACK: '' }))
    .toEqual({ primary: PRIMARY, fallback: FALLBACK });
});

test('the speech selector sends the primary voice ID when no voice env is set', async () => {
  const { calls, fetchImpl } = fakeCartesia([200]);
  const { tts } = selectSpeechProviders({ CARTESIA_API_KEY: 'ct-test-key' }, { fetchImpl });
  await drain(tts.synthesize('two naan', 'en'));
  expect(calls[0].body.voice.id).toBe(PRIMARY);
  expect(calls[0].body.model_id).toBe('sonic-3');
});

test('the speech selector honours CARTESIA_VOICE_ID', async () => {
  const { calls, fetchImpl } = fakeCartesia([200]);
  const { tts } = selectSpeechProviders({ CARTESIA_API_KEY: 'ct-test-key', CARTESIA_VOICE_ID: 'voice-x' }, { fetchImpl });
  await drain(tts.synthesize('two naan', 'en'));
  expect(calls[0].body.voice.id).toBe('voice-x');
});

test('when the primary voice is not found (404), one retry uses the fallback voice', async () => {
  const { calls, fetchImpl } = fakeCartesia([404, 200]);
  const tts = createCartesiaTts({ apiKey: 'ct-test-key', voiceId: PRIMARY, fallbackVoiceId: FALLBACK, fetchImpl });
  await drain(tts.synthesize('two naan', 'en'));
  expect(calls.map((c) => c.body.voice.id)).toEqual([PRIMARY, FALLBACK]);
});

test('other failures are not retried with the fallback voice', async () => {
  const { calls, fetchImpl } = fakeCartesia([500]);
  const tts = createCartesiaTts({ apiKey: 'ct-test-key', voiceId: PRIMARY, fallbackVoiceId: FALLBACK, fetchImpl });
  await expect(drain(tts.synthesize('two naan', 'en'))).rejects.toThrow(/status 500/);
  expect(calls).toHaveLength(1);
});
