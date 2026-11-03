import { runVoiceTurn } from '@/lib/voice/orchestrator';
import { FakeLlm, FakeTranslation, ManualClock } from '@/lib/voice/fakes';
import { SAFE_REPLY } from '@/lib/voice/tools';

const respond = { name: 'respond', arguments: { reply_text: 'Bhaiya, one paneer tikka added.', reply_language: 'hi-en' } };
const cart = (quantity: number) => ({
  name: 'cart_update',
  arguments: { order_type: 'DINE_IN', action: 'ADD', items: [{ item_id: 'pt-1', name: 'Paneer Tikka', quantity }] },
});
const deps = (llm: FakeLlm) => ({ llm, translator: new FakeTranslation({ table: { 'Bhaiya, 2 paneer tikka aur ek naan chahiye': 'Brother, 2 paneer tikka and a naan' } }), clock: new ManualClock() });

test('valid cart_update is returned as a validated action (Review Focus 1)', async () => {
  const llm = new FakeLlm([{ toolCalls: [cart(2), respond] }]);
  const r = await runVoiceTurn(deps(llm), 'Paneer tikka 2 please');
  expect(r.outcome).toBe('ok');
  expect(r.action.kind).toBe('cart_update');
  expect(r.reply_text).toBe('Bhaiya, one paneer tikka added.');
});

test('an invalid output is retried once with the issue, then succeeds', async () => {
  const llm = new FakeLlm([{ toolCalls: [cart(0), respond] }, { toolCalls: [cart(2), respond] }]);
  const r = await runVoiceTurn(deps(llm), 'Paneer tikka 2 please');
  expect(r.outcome).toBe('retried');
  expect(llm.requests).toHaveLength(2);
  expect(llm.requests[1].repairNote).toMatch(/quantity/);
});

test('two invalid outputs return the safe reply and no action', async () => {
  const llm = new FakeLlm([{ toolCalls: [cart(0), respond] }, { toolCalls: [cart(-1), respond] }]);
  const r = await runVoiceTurn(deps(llm), 'Paneer tikka 2 please');
  expect(r.outcome).toBe('safe_fallback');
  expect(r.action).toEqual({ kind: 'none' });
  expect(r.reply_text).toBe(SAFE_REPLY.en);
});

test('an unknown tool name or two action calls is invalid', async () => {
  const llm = new FakeLlm([
    { toolCalls: [{ name: 'delete_everything', arguments: {} }, respond] },
    { toolCalls: [cart(1), cart(1), respond] },
  ]);
  const r = await runVoiceTurn(deps(llm), 'hello');
  expect(r.outcome).toBe('safe_fallback');
});

test('Hinglish input is translated for the LLM and replied in hi-en', async () => {
  const llm = new FakeLlm([{ toolCalls: [cart(2), respond] }]);
  const d = deps(llm);
  const r = await runVoiceTurn(d, 'Bhaiya, 2 paneer tikka aur ek naan chahiye');
  expect(r.detected_language).toBe('hi-en');
  expect(r.reply_language).toBe('hi-en');
  expect(d.translator.calls[0]).toEqual({ text: 'Bhaiya, 2 paneer tikka aur ek naan chahiye', from: 'hi-en', to: 'en' });
  expect(llm.requests[0].user).toContain('Brother, 2 paneer tikka and a naan');
});
