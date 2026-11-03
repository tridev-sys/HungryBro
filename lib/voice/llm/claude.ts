import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmOutput, LlmProvider, LlmRequest } from '../types';
import { toProviderJsonSchema, userMessageFor } from './shared';

export const LLM_TEMPERATURE = 0.1;
export const CLAUDE_MODEL = 'claude-haiku-5-5';
// Claude requires max_tokens. This value is a guess; set it before the first real key (Open Items 9).
export const CLAUDE_MAX_TOKENS = 1024;

export interface ClaudeLike {
  messages: {
    create(params: object): Promise<{ content: Array<{ type: string; name?: string; input?: unknown }> }>;
  };
}

export function createClaudeProvider(opts: { apiKey: string; client?: ClaudeLike }): LlmProvider {
  const client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as ClaudeLike);
  return {
    name: 'claude',
    model: CLAUDE_MODEL,
    async complete(req: LlmRequest): Promise<LlmOutput> {
      const res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
        system: req.system,
        messages: [{ role: 'user', content: userMessageFor(req) }],
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: toProviderJsonSchema(t.schema),
        })),
        tool_choice: { type: 'any' },
      });
      return {
        toolCalls: res.content
          .filter((block) => block.type === 'tool_use')
          .map((block) => ({ name: block.name ?? '', arguments: block.input })),
      };
    },
  };
}
