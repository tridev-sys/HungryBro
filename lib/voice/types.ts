import type { z } from 'zod';

export type LangCode = 'en' | 'hi' | 'hi-en';
export type ReplyLanguage = 'en' | 'hi-en';

export interface Clock {
  now(): number;
}

export interface AudioChunk {
  pcm16: Uint8Array;
  sampleRate: 16000;
}

export interface SttResult {
  text: string;
  language: LangCode;
  confidence: number;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: AudioChunk): Promise<SttResult>;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, language: ReplyLanguage): AsyncIterable<Uint8Array>;
}

export interface TranslationProvider {
  readonly name: string;
  translate(text: string, from: LangCode, to: LangCode): Promise<string>;
}

export interface VadFrameResult {
  speech: boolean;
  level: number;
}

export interface VadProvider {
  readonly name: string;
  process(frame: Float32Array): VadFrameResult;
  reset(): void;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
}

export interface LlmRequest {
  system: string;
  user: string;
  repairNote?: string;
  tools: ToolDef[];
}

export interface LlmToolCall {
  name: string;
  arguments: unknown;
}

export interface LlmOutput {
  toolCalls: LlmToolCall[];
}

export const LLM_PROVIDER_NAMES = ['claude', 'gemini', 'fake'] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmOutput>;
}
