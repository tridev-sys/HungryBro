import { createVoiceTurnHandler } from '@/lib/voice/handler';
import { getVoiceService } from '@/lib/voice/service';

export const runtime = 'nodejs';

const handler = createVoiceTurnHandler(() => getVoiceService());

export async function POST(req: Request) {
  return handler(req);
}
