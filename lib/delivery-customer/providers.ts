// Payment providers for checkout. Razorpay is primary and Cashfree is the fallback (tech decisions).
// A provider whose keys are missing is replaced by one that always fails, so the router still works
// and checkout answers PAYMENT_UNAVAILABLE instead of calling anything.
import { CashfreeProvider } from '@/lib/payments/cashfree';
import { RazorpayProvider } from '@/lib/payments/razorpay';
import { PaymentCreateError, type PaymentProvider, type PaymentProviderName } from '@/lib/payments/types';

export interface CheckoutProviders {
  primary: PaymentProvider;
  fallback: PaymentProvider;
}

let override: CheckoutProviders | null | undefined;

/** Test-only seam: the route tests inject stand-ins here. Refuses to run outside NODE_ENV=test. */
export function setCheckoutProvidersForTest(p: CheckoutProviders | null | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setCheckoutProvidersForTest is test-only');
  override = p;
}

function unavailable(name: PaymentProviderName): PaymentProvider {
  return {
    name,
    async createUpiIntent() {
      throw new PaymentCreateError(`${name} is not configured`);
    },
    verifyWebhook() {
      throw new PaymentCreateError(`${name} is not configured`);
    },
  };
}

/** Null when no provider is configured at all. Keys come from the environment only. */
export function checkoutProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): CheckoutProviders | null {
  if (override !== undefined) return override;
  const payee = env.PAYMENT_MERCHANT_VPA && env.PAYMENT_PAYEE_NAME
    ? { merchantVpa: env.PAYMENT_MERCHANT_VPA, payeeName: env.PAYMENT_PAYEE_NAME }
    : null;
  const razorpay = payee && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
    ? new RazorpayProvider({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
        ...payee,
      })
    : null;
  const cashfree = payee && env.CASHFREE_CLIENT_ID && env.CASHFREE_CLIENT_SECRET && env.CASHFREE_WEBHOOK_SECRET
    ? new CashfreeProvider({
        clientId: env.CASHFREE_CLIENT_ID,
        clientSecret: env.CASHFREE_CLIENT_SECRET,
        webhookSecret: env.CASHFREE_WEBHOOK_SECRET,
        ...payee,
      })
    : null;
  if (!razorpay && !cashfree) return null;
  return {
    primary: razorpay ?? unavailable('razorpay'),
    fallback: cashfree ?? unavailable('cashfree'),
  };
}
