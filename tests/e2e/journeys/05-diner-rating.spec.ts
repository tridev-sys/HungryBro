// Journey 5: rating a completed order. Plan 05 Task 9 (POST /api/ratings) and Task 10 (Route 5 modal).
// The rating modal is mounted on the dine page for a closed table session (DineSurface).
import { test, expect } from '@playwright/test';
import { fixture, shot, signIn, signInTable } from './support/fixtures';

const MODAL_TITLE = 'Rate your experience (verified order)';
const TAGS = ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec'];

test.describe('Journey 5: rating a completed order', () => {
  test('a diner with a completed order sees the rating modal and gets the server answer on submit', async ({ browser }) => {
    const { restaurantId, name } = fixture.dine;
    const context = await browser.newContext();
    await signIn(context, fixture.rating.raterSessionToken);
    await signInTable(context, fixture.rating.tableSessionToken);
    const page = await context.newPage();
    await page.goto(`/dine/${restaurantId}/${fixture.rating.tableNumber}`);

    // The modal opens over the settled table: title, restaurant name, five stars, four tags.
    const dialog = page.getByRole('dialog', { name: MODAL_TITLE });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(5);
    for (const tag of TAGS) {
      await expect(dialog.getByRole('button', { name: tag, exact: true })).toBeVisible();
    }
    await shot(page, 'journey5-rating-modal');

    // Choose 4 stars and the Piping Hot tag, then submit.
    await dialog.getByRole('radio', { name: '4 stars', exact: true }).click();
    const piping = dialog.getByRole('button', { name: 'Piping Hot', exact: true });
    await piping.click();
    await expect(piping).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Submit rating', exact: true }).click();

    // The seeded settlement is older than the 2-second window, so POST /api/ratings answers
    // WINDOW_EXPIRED (422). The modal shows that message and no success message.
    await expect(dialog.getByRole('alert')).toHaveText('The 2-second rating window for this order has closed.');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await shot(page, 'journey5-rating-window-closed');
    await context.close();
  });

  test('a diner without a completed order at this table sees no rating form', async ({ browser }) => {
    const { restaurantId, name } = fixture.dine;
    const context = await browser.newContext();
    await signIn(context, fixture.rating.bystanderSessionToken);
    await signInTable(context, fixture.rating.tableSessionToken);
    const page = await context.newPage();
    await page.goto(`/dine/${restaurantId}/${fixture.rating.tableNumber}`);

    // The page itself has loaded: the restaurant heading and the closed-ordering notice are visible.
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Ordering is closed while the bill is being paid.')).toBeVisible();

    // No rating form for this diner.
    await expect(page.getByRole('dialog', { name: MODAL_TITLE })).toHaveCount(0);
    await expect(page.getByText(MODAL_TITLE, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await shot(page, 'journey5-no-rating-form');
    await context.close();
  });
});
