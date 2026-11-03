import { BUDGETS_MS, TurnTimer, checkBudgets } from '@/lib/voice/latency';
import { ManualClock, FakeStt, FakeTts, FakeLlm } from '@/lib/voice/fakes';

test('budgets are the PDF values', () => {
  expect(BUDGETS_MS).toEqual({ audio_ingress: 200, nlu: 800, tts_first_audio: 150 });
});

test('measure records elapsed fake-clock time, including on throw', async () => {
  const clock = new ManualClock();
  const timer = new TurnTimer(clock);
  await timer.measure('nlu', async () => clock.advance(300));
  await expect(timer.measure('nlu', async () => { clock.advance(10); throw new Error('x'); })).rejects.toThrow('x');
  expect(timer.snapshot().nlu_ms).toBe(10);
});

test('checkBudgets treats a value equal to the limit as a violation', () => {
  expect(checkBudgets({ audio_ingress_ms: 199, nlu_ms: 800, tts_first_audio_ms: 149 }))
    .toEqual([{ stage: 'nlu', limitMs: 800, actualMs: 800 }]);
  expect(checkBudgets({ tts_first_audio_ms: 150 }))
    .toEqual([{ stage: 'tts_first_audio', limitMs: 150, actualMs: 150 }]);
});

test('fake pipeline stays within its budgets (Review Focus 4)', async () => {
  const clock = new ManualClock();
  const timer = new TurnTimer(clock);
  const stt = new FakeStt({ text: 'Bhaiya, 2 paneer tikka chahiye', clock, delayMs: 60 });
  const llm = new FakeLlm([{ toolCalls: [] }], { clock, delayMs: 300 });
  const tts = new FakeTts({ clock, firstChunkDelayMs: 40 });

  await timer.measure('audio_ingress', () => stt.transcribe({ pcm16: new Uint8Array(2), sampleRate: 16000 }));
  await timer.measure('nlu', () => llm.complete({ system: '', user: '', tools: [] }));
  await timer.measure('tts_first_audio', async () => {
    for await (const _chunk of tts.synthesize('ok', 'hi-en')) break;
  });

  expect(checkBudgets(timer.snapshot())).toEqual([]);
});

test('a fake pipeline that exceeds its budget is reported', async () => {
  const clock = new ManualClock();
  const timer = new TurnTimer(clock);
  const llm = new FakeLlm([{ toolCalls: [] }], { clock, delayMs: 900 });
  await timer.measure('nlu', () => llm.complete({ system: '', user: '', tools: [] }));
  expect(checkBudgets(timer.snapshot())).toEqual([{ stage: 'nlu', limitMs: 800, actualMs: 900 }]);
});
