import { z } from 'zod';
import type { LlmRequest } from '../types';

// Converts a Zod schema to JSON Schema for a provider. Gemini rejects $schema, so it is removed.
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export function userMessageFor(req: LlmRequest): string {
  if (!req.repairNote) return req.user;
  return `${req.user}\n\nYour previous answer was invalid: ${req.repairNote}. Answer again using the tools.`;
}
