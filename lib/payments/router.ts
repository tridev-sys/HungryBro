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

const ambiguous = (name: PaymentProviderName, why: string) =>
  new PaymentCreateError(`${name} outcome unknown (${why}); no second order is created`, false);

/**
 * Razorpay is tried once. Cashfree is called only when Razorpay definitely refused the create call
 * (a PaymentCreateError with definite = true, for example a 4xx answer). A timeout, a 5xx answer, a
 * network error, or a 2xx answer without an order id is ambiguous: the order may already exist at
 * Razorpay, so the router stops and never creates a second order elsewhere.
 */
export async function createUpiIntentWithFallback(
  primary: PaymentProvider,
  fallback: PaymentProvider,
  req: UpiIntentRequest,
  log?: (msg: string, meta: Record<string, unknown>) => void,
): Promise<RoutedIntent> {
  const attempted: PaymentProviderName[] = [primary.name];
  let intent: UpiIntent;
  try {
    intent = await primary.createUpiIntent(req);
  } catch (e) {
    if (!(e instanceof PaymentCreateError && e.definite)) throw ambiguous(primary.name, errorText(e));
    log?.('payment_fallback', { from: primary.name, to: fallback.name, reason: errorText(e) });
    attempted.push(fallback.name);
    try {
      const fb = await fallback.createUpiIntent(req);
      if (!fb.providerOrderId) throw ambiguous(fallback.name, 'response had no order id');
      return { ...fb, attempted };
    } catch (fe) {
      throw new PaymentCreateError(
        `both providers failed: ${primary.name} (${errorText(e)}); ${fallback.name} (${errorText(fe)})`,
        false,
      );
    }
  }
  if (!intent.providerOrderId) throw ambiguous(primary.name, 'response had no order id');
  return { ...intent, attempted };
}
