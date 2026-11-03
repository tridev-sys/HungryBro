import { z } from 'zod';
import type { Clock, LangCode, LlmProvider, LlmToolCall, ReplyLanguage, TranslationProvider } from './types';
import { detectLanguage, replyLanguageFor, translateForLlm } from './language';
import { TurnTimer, type TurnTiming } from './latency';
import {
  ActionPlanSchema,
  ReplySchema,
  SAFE_REPLY,
  TOOL_DEFS,
  type ActionPlan,
  type Reply,
} from './tools';

export interface VoiceDeps {
  llm: LlmProvider;
  translator: TranslationProvider;
  clock: Clock;
  systemPrompt?: string;
}

export type TurnOutcome = 'ok' | 'retried' | 'safe_fallback';

export interface VoiceTurnResult {
  action: ActionPlan;
  reply_text: string;
  reply_language: ReplyLanguage;
  outcome: TurnOutcome;
  detected_language: LangCode;
  timing: TurnTiming;
}

const DEFAULT_SYSTEM = [
  'You are the voice assistant for a restaurant. Use only the provided tools.',
  'Call respond exactly once with the reply for the guest.',
  'Call at most one of cart_update or delivery_intent, and only when the guest asked for it.',
  "Set reply_language to 'hi-en' when the guest spoke Hindi or Hinglish, otherwise 'en'.",
  'Keep reply_text short. Hinglish replies look like: "Bhaiya, I found 3 Jain starters."',
].join('\n');

const ACTION_NAMES = ['cart_update', 'delivery_intent'] as const;
const KNOWN_NAMES = new Set<string>([...ACTION_NAMES, 'respond']);

type Parsed =
  | { ok: true; value: ActionPlan & { reply: Reply } }
  | { ok: false; issues: string };

function zodIssues(tool: string, err: z.ZodError): string {
  return err.issues
    .map((i) => `${tool}: ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

// Fixed order; the first failure wins. See Task 8 of the plan.
export function parseToolCalls(calls: LlmToolCall[]): Parsed {
  for (const c of calls) {
    if (!KNOWN_NAMES.has(c.name)) {
      return { ok: false, issues: `${c.name}: unknown tool name` };
    }
  }

  const responds = calls.filter((c) => c.name === 'respond');
  if (responds.length !== 1) {
    return { ok: false, issues: `respond: expected exactly one call, got ${responds.length}` };
  }
  const reply = ReplySchema.safeParse(responds[0].arguments);
  if (!reply.success) {
    return { ok: false, issues: zodIssues('respond', reply.error) };
  }

  const actions = calls.filter((c) => c.name !== 'respond');
  if (actions.length > 1) {
    return { ok: false, issues: `action: expected at most one action call, got ${actions.length}` };
  }
  if (actions.length === 0) {
    return { ok: true, value: { kind: 'none', reply: reply.data } };
  }

  const action = actions[0];
  const plan = ActionPlanSchema.safeParse({ kind: action.name, args: action.arguments });
  if (!plan.success) {
    return { ok: false, issues: zodIssues(action.name, plan.error) };
  }
  return { ok: true, value: { ...plan.data, reply: reply.data } };
}

export async function runVoiceTurn(deps: VoiceDeps, transcript: string): Promise<VoiceTurnResult> {
  const timer = new TurnTimer(deps.clock);
  const detected = detectLanguage(transcript);
  const system = deps.systemPrompt ?? DEFAULT_SYSTEM;

  const attempt = await timer.measure('nlu', async () => {
    const user = await translateForLlm(deps.translator, transcript, detected);

    const first = parseToolCalls((await deps.llm.complete({ system, user, tools: TOOL_DEFS })).toolCalls);
    if (first.ok) return { outcome: 'ok' as const, parsed: first.value };

    const second = parseToolCalls(
      (await deps.llm.complete({ system, user, tools: TOOL_DEFS, repairNote: first.issues })).toolCalls,
    );
    if (second.ok) return { outcome: 'retried' as const, parsed: second.value };

    return { outcome: 'safe_fallback' as const, parsed: null };
  });

  const timing = timer.snapshot();
  if (attempt.parsed === null) {
    const language = replyLanguageFor(detected);
    return {
      action: { kind: 'none' },
      reply_text: SAFE_REPLY[language],
      reply_language: language,
      outcome: 'safe_fallback',
      detected_language: detected,
      timing,
    };
  }

  const { reply, ...action } = attempt.parsed;
  return {
    action: action as ActionPlan,
    reply_text: reply.reply_text,
    reply_language: reply.reply_language,
    outcome: attempt.outcome,
    detected_language: detected,
    timing,
  };
}
