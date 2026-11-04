import { test, expect } from '@playwright/test';
import { FIXTURE_RESTAURANTS, DROP } from '@/lib/seed/fixtures';

const seededIds = new Set(FIXTURE_RESTAURANTS.map((r) => r.id));

test('one voice query returns ranked bundles from several seeded kitchens', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/delivery?lat=${DROP.lat}&lng=${DROP.lng}`);
  await page.getByLabel('Voice search').fill(
    'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  );
  await page.getByRole('button', { name: 'Find food' }).click();

  const bundles = page.getByTestId('bundle-card');
  await expect.poll(() => bundles.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const ranks = await bundles.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-rank'))));
  expect(ranks).toEqual(ranks.map((_, i) => i + 1));

  const merchants = await bundles.evaluateAll((els) => els.map((e) => e.getAttribute('data-restaurant-id') ?? ''));
  expect(new Set(merchants).size).toBeGreaterThanOrEqual(2);
  for (const id of merchants) expect(seededIds.has(id)).toBe(true);

  const prices = await bundles.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-price'))));
  for (const p of prices) expect(p).toBeLessThanOrEqual(800);
});
