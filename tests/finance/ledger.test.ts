import {
  OUTLET_SAAS_FEE_INR,
  DISPATCH_BASELINE_COST_INR,
  monthlySaasCharge,
  withPassThrough,
} from '@/lib/finance/ledger';

test('the SaaS fee is 499 INR per physical outlet per month', () => {
  expect(OUTLET_SAAS_FEE_INR).toBe(499);
  expect(monthlySaasCharge(1)).toBe(499);
  expect(monthlySaasCharge(3)).toBe(1497);
  expect(monthlySaasCharge(0)).toBe(0);
});

test('the SaaS charge rounds half-up to paise', () => {
  expect(monthlySaasCharge(1, 0.125)).toBe(0.13);
  expect(monthlySaasCharge(1, 0.005)).toBe(0.01);
  expect(monthlySaasCharge(2, 0.004)).toBe(0.01);
});

test('the SaaS charge rejects non-integer or negative outlet counts', () => {
  expect(() => monthlySaasCharge(-1)).toThrow(RangeError);
  expect(() => monthlySaasCharge(1.5)).toThrow(RangeError);
  expect(() => monthlySaasCharge(Number.NaN)).toThrow(RangeError);
});

test('the 3PL baseline is 50 INR, used only as a config default', () => {
  expect(DISPATCH_BASELINE_COST_INR).toBe(50);
});

test('delivery pass-through adds the dispatch cost to the order total at cost', () => {
  expect(withPassThrough(320, 50)).toEqual({ orderTotalInr: 320, passThroughCostInr: 50, totalInr: 370 });
  expect(withPassThrough(320.1, 49.99).totalInr).toBe(370.09);
});

test('pass-through rounds half-up and rejects negative amounts', () => {
  expect(withPassThrough(100, 0.005).totalInr).toBe(100.01);
  expect(() => withPassThrough(-1, 50)).toThrow(RangeError);
  expect(() => withPassThrough(100, -5)).toThrow(RangeError);
});
