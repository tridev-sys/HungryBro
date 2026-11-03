import 'server-only';
import { selectLlmProvider } from './llm/select';
import { selectSpeechProviders } from './providers/select';
import type { VoiceDeps } from './orchestrator';
import type { VoiceService } from './handler';

type Env = Record<string, string | undefined>;

let memoized: VoiceService | undefined;

function build(env: Env): VoiceService {
  const llm = selectLlmProvider(env, console);
  const translator = selectSpeechProviders(env).translation;
  const deps: VoiceDeps = {
    llm,
    translator,
    clock: { now: () => performance.now() },
  };
  return { deps, llmName: llm.name };
}

// Memoized per process when env is omitted (the real process.env path).
export function getVoiceService(env?: Env): VoiceService {
  if (env) return build(env);
  if (!memoized) memoized = build(process.env);
  return memoized;
}
