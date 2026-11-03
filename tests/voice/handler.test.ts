import { createVoiceTurnHandler } from '@/lib/voice/handler';
import { FakeLlm, FakeTranslation, ManualClock } from '@/lib/voice/fakes';

const service = (llm: FakeLlm) => ({
  llmName: 'fake',
  deps: { llm, translator: new FakeTranslation(), clock: new ManualClock() },
});
const post = (body: unknown) => new Request('http://localhost:3000/api/voice/turn', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const logs: string[] = [];
const logger = { info: (l: string) => logs.push(l), error: (l: string) => logs.push(l) };

test('rejects an empty or oversized transcript with 400', async () => {
  const handler = createVoiceTurnHandler(() => service(new FakeLlm([])), logger);
  expect((await handler(post({ transcript: '   ' }))).status).toBe(400);
  expect((await handler(post({ transcript: 'x'.repeat(501) }))).status).toBe(400);
});

test('returns a validated action, reply, and timing with 200', async () => {
  const llm = new FakeLlm([{ toolCalls: [
    { name: 'cart_update', arguments: { order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: 'n', name: 'Naan', quantity: 2 }] } },
    { name: 'respond', arguments: { reply_text: 'Two naan added.', reply_language: 'en' } },
  ] }]);
  const res = await createVoiceTurnHandler(() => service(llm), logger)(post({ transcript: 'two naan' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.action.kind).toBe('cart_update');
  expect(body.timing).toHaveProperty('nlu_ms');
  expect(body.llm).toBe('fake');
});

test('the log line never contains the transcript (Review Focus 5)', async () => {
  logs.length = 0;
  const llm = new FakeLlm([{ toolCalls: [{ name: 'respond', arguments: { reply_text: 'ok', reply_language: 'en' } }] }]);
  await createVoiceTurnHandler(() => service(llm), logger)(post({ transcript: 'secret dinner plan' }));
  expect(logs.join('\n')).not.toContain('secret dinner plan');
});

test('an internal failure returns 500 without a stack trace', async () => {
  const bad = { llmName: 'fake', deps: { llm: { name: 'fake', model: 'fake', complete: async () => { throw new Error('boom'); } }, translator: new FakeTranslation(), clock: new ManualClock() } };
  const res = await createVoiceTurnHandler(() => bad as never, logger)(post({ transcript: 'hi' }));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'internal' });
});
