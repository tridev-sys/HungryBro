// Journey 2: a delivery order from a spoken-style request. Plan 02 Task 10 and Task 8.
import { test, expect } from '@playwright/test';
import { fixture, shot, signIn } from './support/fixtures';

test.describe('Journey 2: delivery order', () => {
  test('metadata card, ranked counter-bids, and the 3PL panel', async ({ page, context }) => {
    // Delivery needs a signed-in diner (POST /api/delivery/intent returns 401 without one).
    await signIn(context, fixture.diner.sessionToken);
    await page.goto('/delivery');
    await expect(page.getByRole('heading', { level: 1, name: 'Order delivery' })).toBeVisible();

    // The request is typed here, since the mic is a placeholder until Plan 04.
    const request = 'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar';
    await page.getByPlaceholder(/Dinner for 3/).fill(request);
    await page.getByRole('button', { name: 'Find kitchens' }).click();

    // Extracted metadata card: budget, SLA, headcount, items, and coordinates.
    const card = page.locator('dl');
    await expect(card.getByText('₹800', { exact: true })).toBeVisible();
    await expect(card.getByText('30 min', { exact: true })).toBeVisible();
    await expect(card.getByText('3', { exact: true })).toBeVisible();
    await expect(card.getByText('biryani x1, kebab x1')).toBeVisible();
    await expect(card.getByText('Indiranagar (12.9719, 77.6408)')).toBeVisible();
    await shot(page, 'journey2-metadata');

    // Live counter-bids open with a countdown from the server window.
    await expect(page.getByRole('heading', { name: 'Live counter-bids' })).toBeVisible();
    await expect(page.getByText(/\d+s left/)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'E2E Kitchen' }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await shot(page, 'journey2-counter-bids');

    // After the 18 s window: the winning match and the runner-up, from the ranked bundles.
    await expect(page.getByText('Winning Match')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Runner Up')).toBeVisible();

    // The 3PL status panel appears once the auction is awarded (SSE "dispatch" event).
    const panel = page.locator('section').filter({ hasText: 'Handshake code:' });
    await expect(panel.getByRole('heading', { name: 'Delivery' })).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByText(/Hot bag \d+ °C/)).toBeVisible();
    await expect(panel.getByText(/ETA \S+ min/)).toBeVisible();
    await expect(panel.getByText(/Handshake code:\s*[0-9a-z]{4}-[0-9a-z]{4}/i)).toBeVisible();
    await shot(page, 'journey2-3pl-panel');
  });
});
