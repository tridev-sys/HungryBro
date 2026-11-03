import { FakePaymentIntentAdapter } from './fake';
import type { PaymentIntentAdapter } from './intent';

let shared: PaymentIntentAdapter | undefined;

/** Plan 03 is fake-only. Plan 06 changes this to select Razorpay or Cashfree. */
export function getPaymentAdapter(): PaymentIntentAdapter {
  shared ??= new FakePaymentIntentAdapter();
  return shared;
}
