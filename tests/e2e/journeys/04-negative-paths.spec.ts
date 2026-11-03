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
    // API-level check only. No UI path can send this value (see the skipped test below).
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

  // NOT IMPLEMENTED. The delivery console has no latitude input. It builds coordinates only from the
  // fixed locality map in lib/delivery/stub-extract.ts (Indiranagar, HSR), and on a missing locality it
  // shows "Pick a pilot locality", never a server validation message. Looked in:
  // app/delivery/_components/DeliveryConsole.tsx, app/delivery/_components/VoiceInput.tsx,
  // lib/delivery/stub-extract.ts.
  test.skip('NOT IMPLEMENTED: a delivery request with latitude 250 shows a visible rejection message', async ({ page }) => {
    await page.goto('/delivery');
  });
});
