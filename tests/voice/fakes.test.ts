import { ManualClock, FakeStt, FakeLlm, FakeTranslation } from '@/lib/voice/fakes';

test('ManualClock advances only when told to', () => {
  const c = new ManualClock();
  expect(c.now()).toBe(0);
  c.advance(250);
  expect(c.now()).toBe(250);
});

test('FakeStt returns scripted text and charges its delay to the clock', async () => {
  const clock = new ManualClock();
  const stt = new FakeStt({ text: 'dinner for three', clock, delayMs: 50 });
  const r = await stt.transcribe({ pcm16: new Uint8Array(4), sampleRate: 16000 });
  expect(r.text).toBe('dinner for three');
  expect(r.language).toBe('en');
  expect(clock.now()).toBe(50);
});

test('FakeTranslation records calls and falls back to identity', async () => {
  const t = new FakeTranslation({ table: { 'ek naan': 'one naan' } });
  expect(await t.translate('ek naan', 'hi-en', 'en')).toBe('one naan');
  expect(await t.translate('Biryani', 'en', 'en')).toBe('Biryani');
  expect(t.calls).toHaveLength(2);
});

test('FakeLlm throws when it runs out of scripted outputs', async () => {
  const llm = new FakeLlm([{ toolCalls: [] }]);
  await llm.complete({ system: '', user: '', tools: [] });
  await expect(llm.complete({ system: '', user: '', tools: [] })).rejects.toThrow(/no scripted output/);
});
