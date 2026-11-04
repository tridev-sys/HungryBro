import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { createVoiceTurnHandler } from '@/lib/voice/handler';
import { getVoiceService } from '@/lib/voice/service';

export const runtime = 'nodejs';

const handler = createVoiceTurnHandler(() => getVoiceService());

async function handlePost(req: Request) {
  return handler(req);
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
