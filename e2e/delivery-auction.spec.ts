import { test, expect } from '@playwright/test';
import { FIXTURE_RESTAURANTS, DROP } from '@/lib/seed/fixtures';
import { fixture, signIn } from '../tests/e2e/journeys/support/fixtures';

// Delivery requests need a signed-in diner (POST /api/delivery/intent returns 401 without one).
// The diner session comes from the journey fixture file, the same way the journey specs get theirs.
const seededIds = new Set(FIXTURE_RESTAURANTS.map((r) => r.id));
const seededNames = new Set(FIXTURE_RESTAURANTS.map((r) => r.name));

test('one voice query returns ranked bundles from several seeded kitchens', async ({ page, context }) => {
  test.setTimeout(90_000);
  await signIn(context, fixture.diner.sessionToken);
  await page.goto('/delivery');

  // The page no longer reads ?lat&lng. Coordinates come from the manual fields (or live browser
  // location, which this headless context does not grant), so the drop point is typed in.
  await page.getByLabel('Latitude').fill(String(DROP.lat));
  await page.getByLabel('Longitude').fill(String(DROP.lng));

  await page.getByPlaceholder(/Dinner for 3/).fill(
    'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  );
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/delivery/intent') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Find kitchens' }).click();
  const res = await response;
  expect(res.status()).toBe(201);

  // Bundles are shown once the bid window closes (18 s), as the winning and runner-up match.
  await expect(page.getByText('Window closed')).toBeVisible({ timeout: 45_000 });
  const body = (await res.json()) as {
    bundles: Array<{ restaurantId: string; offeredPriceInr: number }>;
  };
  expect(body.bundles.length).toBeGreaterThanOrEqual(2);

  const merchants = body.bundles.map((b) => b.restaurantId);
  expect(new Set(merchants).size).toBeGreaterThanOrEqual(2);
  for (const id of merchants) expect(seededIds.has(id)).toBe(true);

  for (const b of body.bundles) expect(b.offeredPriceInr).toBeLessThanOrEqual(800);

  // The UI shows the top two bundles by rank: winner first, then runner-up.
  const winnerCard = page.getByText('Winning Match', { exact: true }).locator('..');
  const runnerCard = page.getByText('Runner Up', { exact: true }).locator('..');
  await expect(winnerCard).toBeVisible();
  await expect(runnerCard).toBeVisible();
  const [winner, runnerUp] = body.bundles;
  const winnerName = FIXTURE_RESTAURANTS.find((r) => r.id === winner.restaurantId)?.name ?? '';
  const runnerName = FIXTURE_RESTAURANTS.find((r) => r.id === runnerUp.restaurantId)?.name ?? '';
  expect(seededNames.has(winnerName)).toBe(true);
  expect(seededNames.has(runnerName)).toBe(true);
  await expect(winnerCard.getByText(winnerName, { exact: true })).toBeVisible();
  await expect(runnerCard.getByText(runnerName, { exact: true })).toBeVisible();
});
