import { LLM_PROVIDER_NAMES } from '@/lib/voice/types';

test('LLM provider names are exactly the three supported adapters', () => {
  expect(LLM_PROVIDER_NAMES).toEqual(['claude', 'gemini', 'fake']);
});
