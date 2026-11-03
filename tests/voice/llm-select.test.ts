import { vi } from 'vitest';
import { selectLlmProvider } from '@/lib/voice/llm/select';
import { createClaudeProvider } from '@/lib/voice/llm/claude';
import { createGeminiProvider } from '@/lib/voice/llm/gemini';

const logger = { warn: vi.fn() };
const cfg = (env: Record<string, string>) => selectLlmProvider(env, logger);

test('LLM_PROVIDER=claude requires ANTHROPIC_API_KEY', () => {
  expect(() => cfg({ LLM_PROVIDER: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
});

test('LLM_PROVIDER=gemini overrides an Anthropic key', () => {
  expect(cfg({ LLM_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).name).toBe('gemini');
});

test('unknown LLM_PROVIDER value throws', () => {
  expect(() => cfg({ LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
});

test('without an override, Claude wins when both keys are present', () => {
  expect(cfg({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).name).toBe('claude');
});

test('without an override, Gemini is used when only its key is present', () => {
  expect(cfg({ GEMINI_API_KEY: 'g' }).name).toBe('gemini');
});

test('with no keys, the fake is used and a warning is logged (Review Focus 2)', () => {
  const warn = vi.fn();
  expect(selectLlmProvider({}, { warn }).name).toBe('fake');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).not.toMatch(/key/i);
});

test('Claude adapter pins model and temperature 0.1', async () => {
  const create = vi.fn(async (_params: object) => ({ content: [{ type: 'tool_use', name: 'respond', input: { reply_text: 'ok', reply_language: 'en' } }] }));
  const p = createClaudeProvider({ apiKey: 'test', client: { messages: { create } } });
  const out = await p.complete({ system: 's', user: 'u', tools: [] });
  expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', temperature: 0.1 });
  expect(out.toolCalls).toEqual([{ name: 'respond', arguments: { reply_text: 'ok', reply_language: 'en' } }]);
});

test('Gemini adapter pins model and temperature 0.1', async () => {
  const generateContent = vi.fn(async (_params: object) => ({ functionCalls: [{ name: 'respond', args: { reply_text: 'ok', reply_language: 'en' } }] }));
  const p = createGeminiProvider({ apiKey: 'test', client: { models: { generateContent } } });
  const out = await p.complete({ system: 's', user: 'u', tools: [] });
  expect(generateContent.mock.calls[0][0]).toMatchObject({ model: 'gemini-2.5-flash', config: { temperature: 0.1 } });
  expect(out.toolCalls[0].name).toBe('respond');
});
