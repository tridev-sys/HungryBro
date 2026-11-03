import {
  PaymentCreateError,
  type PaymentProvider,
  type PaymentProviderName,
  type UpiIntent,
  type UpiIntentRequest,
} from './types';

export interface RoutedIntent extends UpiIntent {
  attempted: PaymentProviderName[];
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Razorpay is tried once. Cashfree is called only when that create call throws or returns
// no order id. A Razorpay success never creates a second order.
export async function createUpiIntentWithFallback(
  primary: PaymentProvider,
  fallback: PaymentProvider,
  req: UpiIntentRequest,
  log?: (msg: string, meta: Record<string, unknown>) => void,
): Promise<RoutedIntent> {
  const attempted: PaymentProviderName[] = [primary.name];
  let primaryError: string;
  try {
    const intent = await primary.createUpiIntent(req);
    if (intent.providerOrderId) return { ...intent, attempted };
    primaryError = 'response had no order id';
  } catch (e) {
    primaryError = errorText(e);
  }

  log?.('payment_fallback', { from: primary.name, to: fallback.name, reason: primaryError });
  attempted.push(fallback.name);
  try {
    const intent = await fallback.createUpiIntent(req);
    if (!intent.providerOrderId) throw new Error('response had no order id');
    return { ...intent, attempted };
  } catch (e) {
    throw new PaymentCreateError(
      `both providers failed: ${primary.name} (${primaryError}); ${fallback.name} (${errorText(e)})`,
    );
  }
}
