import { z } from 'zod';
import { runVoiceTurn, type VoiceDeps } from './orchestrator';
import { checkBudgets } from './latency';

export const TurnRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(500),
});

export interface VoiceService {
  deps: VoiceDeps;
  llmName: string;
}

export interface TurnLogger {
  info(line: string): void;
  error(line: string): void;
}

const defaultLogger: TurnLogger = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

const invalidRequest = () => Response.json({ error: 'invalid_request' }, { status: 400 });

export function createVoiceTurnHandler(
  getService: () => VoiceService,
  logger: TurnLogger = defaultLogger,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return invalidRequest();
    }
    const parsed = TurnRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidRequest();
    }

    try {
      const service = getService();
      const result = await runVoiceTurn(service.deps, parsed.data.transcript);
      const budget_violations = checkBudgets(result.timing);
      logger.info(JSON.stringify({
        event: 'voice_turn',
        outcome: result.outcome,
        llm: service.llmName,
        timing: result.timing,
        budget_violations,
      }));
      return Response.json({
        action: result.action,
        reply_text: result.reply_text,
        reply_language: result.reply_language,
        outcome: result.outcome,
        detected_language: result.detected_language,
        timing: result.timing,
        llm: service.llmName,
        budget_violations,
      });
    } catch (err) {
      logger.error(JSON.stringify({
        event: 'voice_turn_error',
        error: err instanceof Error ? err.name : 'unknown',
      }));
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  };
}
