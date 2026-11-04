// Journey 4: negative paths. Plan 03 Task 10 and Task 11 (403 copy), Plan 02 Task 8 (400 on bad coordinates).
import { test, expect } from '@playwright/test';
import { fixture, shot, signIn } from './support/fixtures';

const SIG_NOT_VALID = 'This table code is not valid. Ask staff for help.';

test.describe('Journey 4: negative paths', () => {
  test('a diner cannot open a restaurant kitchen display', async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context, fixture.diner.sessionToken);
    const page = await context.newPage();
    await page.goto(`/ops/${fixture.dine.restaurantId}/kds`);
    await expect(page.getByText(/^403: this kitchen belongs to another restaurant/)).toBeVisible();
    await expect(page.getByText(/Load: \d+%/)).toHaveCount(0);
    await shot(page, 'journey4-diner-kds-403');
    await context.close();
  });

  test('staff of another restaurant cannot open this kitchen display', async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context, fixture.staffB.sessionToken);
    const page = await context.newPage();
    await page.goto(`/ops/${fixture.dine.restaurantId}/kds`);
    await expect(page.getByText(/^403: this kitchen belongs to another restaurant/)).toBeVisible();
    await expect(page.getByText(/Load: \d+%/)).toHaveCount(0);
    await context.close();
  });

  test('an unknown table signature shows an error and no menu', async ({ page }) => {
    const { restaurantId } = fixture.dine;
    await page.goto(`/dine/${restaurantId}/1?sig=${'0'.repeat(32)}`);
    await expect(page.locator('p[role="alert"]')).toHaveText(SIG_NOT_VALID);
    await expect(page.getByRole('list', { name: 'Menu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0);
    await shot(page, 'journey4-bad-signature');
  });

  test('a table number that does not exist shows an error and no menu', async ({ page }) => {
    const { restaurantId, tables } = fixture.dine;
    await page.goto(`/dine/${restaurantId}/99?sig=${tables['1']}`);
    await expect(page.locator('p[role="alert"]')).toHaveText(SIG_NOT_VALID);
    await expect(page.getByRole('list', { name: 'Menu' })).toHaveCount(0);
  });

  test('API rejects latitude 250 with 400 and names the coordinate field', async ({ request }) => {
    // API-level check. The delivery console blocks this value before it is sent (see the UI test below).
    const res = await request.post('/api/delivery/intent', {
      headers: { cookie: `fos_session=${fixture.diner.sessionToken}` },
      data: {
        transcript: 'Biryani under 800 in 30 mins to Indiranagar',
        intent: {
          modality: 'DELIVERY',
          budget_ceiling_inr: 800,
          sla_max_minutes: 30,
          headcount: 1,
          target_dietary_profiles: [],
          items_requested: [{ query: 'biryani', serving_target: 1 }],
          client_coordinates: { lat: 250, lng: 77.6408 },
        },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid request');
    expect(JSON.stringify(body.issues)).toContain('client_coordinates');
  });

  test('a delivery request with latitude 250 shows a visible rejection message and is not sent', async ({ page, context }) => {
    await signIn(context, fixture.diner.sessionToken);
    const sent: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/delivery/intent') && req.method() === 'POST') sent.push(req.url());
    });
    await page.goto('/delivery');
    await page.getByPlaceholder(/Dinner for 3/).fill('Biryani under 800 in 30 mins to Indiranagar');
    await page.getByLabel('Latitude').fill('250');
    await page.getByLabel('Longitude').fill('77.6408');
    await page.getByRole('button', { name: 'Find kitchens' }).click();

    await expect(page.getByText('Latitude must be between -90 and 90')).toBeVisible();
    await expect(page.getByLabel('Latitude')).toHaveAttribute('aria-invalid', 'true');
    await shot(page, 'journey4-latitude-250');
    expect(sent).toHaveLength(0);
  });
});
