import 'server-only';
import { GoogleGenAI } from '@google/genai';
import type { LlmOutput, LlmProvider, LlmRequest } from '../types';
import { toProviderJsonSchema, userMessageFor } from './shared';

export const LLM_TEMPERATURE = 0.1;
export const GEMINI_MODEL = 'gemini-2.5-flash';

export interface GeminiLike {
  models: {
    generateContent(params: object): Promise<{ functionCalls?: Array<{ name?: string; args?: unknown }> }>;
  };
}

export function createGeminiProvider(opts: { apiKey: string; client?: GeminiLike }): LlmProvider {
  const client = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GeminiLike);
  return {
    name: 'gemini',
    model: GEMINI_MODEL,
    async complete(req: LlmRequest): Promise<LlmOutput> {
      const res = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: userMessageFor(req),
        config: {
          temperature: LLM_TEMPERATURE,
          systemInstruction: req.system,
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: toProviderJsonSchema(t.schema),
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        },
      });
      return {
        toolCalls: (res.functionCalls ?? []).map((call) => ({ name: call.name ?? '', arguments: call.args })),
      };
    },
  };
}
