// Journey 1: a diner at a table (dine-in). Plan 03 Task 10, Plan 08 Tasks 4-7.
import { test, expect } from '@playwright/test';
import { fixture, shot } from './support/fixtures';

test.describe('Journey 1: diner at a table (dine-in)', () => {
  test('opens the table from its signature URL, filters, orders, and sees the bill', async ({ page }) => {
    const { restaurantId, name, tables } = fixture.dine;

    // A guest scans the table QR code. No sign-in is needed for dine-in.
    await page.goto(`/dine/${restaurantId}/1?sig=${tables['1']}`);

    // Restaurant name and the rating label. A restaurant with no verified reviews shows "No ratings yet".
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('No ratings yet').first()).toBeVisible();

    // The table session opens on mount, which reveals the menu.
    const menu = page.getByRole('list', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Chicken Biryani', { exact: true })).toBeVisible();
    await expect(menu.getByText('Veg Seekh', { exact: true })).toBeVisible();

    // Pure Veg keeps pure and Jain dishes, so the biryani drops out.
    const pureVeg = page.getByRole('button', { name: 'Pure Veg', exact: true });
    const jain = page.getByRole('button', { name: 'Jain', exact: true });
    await pureVeg.click();
    await expect(pureVeg).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByText('Chicken Biryani', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Veg Seekh', { exact: true })).toBeVisible();

    // Jain and Pure Veg are AND-ed, so only the Jain dish stays.
    await jain.click();
    await expect(jain).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByText('Veg Seekh', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Paneer Tikka', { exact: true })).toBeVisible();
    await shot(page, 'journey1-filters-jain');

    // Add the Jain dish. The ticket appears in the live feed with its item line.
    await menu.getByRole('button', { name: 'Add Paneer Tikka', exact: true }).click();
    await expect(page.getByText('1x Paneer Tikka', { exact: true })).toBeVisible();
    await expect(page.getByText(/Ticket #\d{2}/).first()).toBeVisible();

    // Settlement: Rs 400 subtotal, 5% GST of Rs 20, total Rs 420. Scoped to the bill panel,
    // because the menu price label also reads Rs 400.00.
    const bill = page.locator('section').filter({ hasText: 'GST (5%)' });
    await expect(bill).toBeVisible();
    await expect(bill.locator('dd', { hasText: /^₹400\.00$/ })).toBeVisible();
    await expect(bill.locator('dd', { hasText: /^₹20\.00$/ })).toBeVisible();
    await expect(bill.getByText('₹420.00', { exact: true }).first()).toBeVisible();

    // The pay action is on screen.
    await expect(page.getByRole('button', { name: 'PAY', exact: true })).toBeVisible();
    await shot(page, 'journey1-settlement');
  });
});
