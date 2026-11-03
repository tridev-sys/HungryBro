import 'server-only';
import type { LlmProvider } from '../types';
import { createClaudeProvider, type ClaudeLike } from './claude';
import { createGeminiProvider, type GeminiLike } from './gemini';

export interface LlmSelectLogger {
  warn(msg: string): void;
}

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

// Used only when no LLM key is set. Replies with a fixed message so the endpoint still answers.
function unconfiguredFake(): LlmProvider {
  return {
    name: 'fake',
    model: 'fake',
    async complete() {
      return {
        toolCalls: [
          {
            name: 'respond',
            arguments: { reply_text: 'The voice assistant is not configured yet.', reply_language: 'en' },
          },
        ],
      };
    },
  };
}

export function selectLlmProvider(
  env: Record<string, string | undefined>,
  logger: LlmSelectLogger,
  deps: { claudeClient?: ClaudeLike; geminiClient?: GeminiLike } = {},
): LlmProvider {
  const override = env.LLM_PROVIDER;
  if (present(override)) {
    if (override === 'claude') {
      if (!present(env.ANTHROPIC_API_KEY)) {
        throw new Error('LLM_PROVIDER=claude requires ANTHROPIC_API_KEY');
      }
      return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, client: deps.claudeClient });
    }
    if (override === 'gemini') {
      if (!present(env.GEMINI_API_KEY)) {
        throw new Error('LLM_PROVIDER=gemini requires GEMINI_API_KEY');
      }
      return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, client: deps.geminiClient });
    }
    throw new Error(`Unknown LLM_PROVIDER "${override}"; expected claude, gemini`);
  }
  if (present(env.ANTHROPIC_API_KEY)) {
    return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, client: deps.claudeClient });
  }
  if (present(env.GEMINI_API_KEY)) {
    return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, client: deps.geminiClient });
  }
  logger.warn('No LLM provider configured; using the fake LLM');
  return unconfiguredFake();
}
