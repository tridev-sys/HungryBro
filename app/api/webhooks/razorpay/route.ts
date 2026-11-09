import { withApiGuards, publicSessionToken } from '@/lib/http/guard';
import { getPool } from '@/lib/db/client';
import { handleProviderWebhook } from '@/lib/payments/webhook-handler';

// Every payment webhook goes through handleProviderWebhook: verify first, then one database call.
async function handlePost(req: Request): Promise<Response> {
  return handleProviderWebhook(req, 'razorpay', await getPool());
}

export const POST = withApiGuards(handlePost, { sessionToken: publicSessionToken });
