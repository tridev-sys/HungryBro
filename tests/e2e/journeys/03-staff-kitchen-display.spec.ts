// Journey 3: staff at the kitchen display. Plan 03 Task 9 and Task 11, Plan 08 Task 4.
import { test, expect } from '@playwright/test';
import { fixture, shot, signIn } from './support/fixtures';

test.describe('Journey 3: staff at the kitchen display', () => {
  test('load, station tabs, live ticket arrival, and bump actions without a reload', async ({ browser }) => {
    const { restaurantId, name, tables } = fixture.dine;

    // Staff A signs in and opens the KDS for their own restaurant. The board stays open for the whole journey.
    const staffContext = await browser.newContext();
    await signIn(staffContext, fixture.staffA.sessionToken);
    const staff = await staffContext.newPage();
    await staff.goto(`/ops/${restaurantId}/kds`);
    await expect(staff.getByText(`${name} · Kitchen`)).toBeVisible();
    await expect(staff.getByText(/Load: \d+%/)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await shot(staff, 'journey3-kds-open');

    // A guest at table 2 orders two dishes from another browser, on two stations.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(`/dine/${restaurantId}/2?sig=${tables['2']}`);
    await expect(guest.getByRole('list', { name: 'Menu' })).toBeVisible();
    await guest.getByRole('button', { name: 'Add Paneer Tikka', exact: true }).click();
    await expect(guest.getByText('1x Paneer Tikka', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Add Mango Lassi', exact: true }).click();
    await expect(guest.getByText('1x Mango Lassi', { exact: true })).toBeVisible();

    // The new tickets reach the board over SSE. Staff never reloaded the page.
    const paneerTicket = staff.locator('article').filter({ hasText: 'DINE-IN: Table 2' }).filter({ hasText: /1x Paneer Tikka/ });
    const lassiTicket = staff.locator('article').filter({ hasText: 'DINE-IN: Table 2' }).filter({ hasText: /1x Mango Lassi/ });
    await expect(paneerTicket).toBeVisible({ timeout: 20_000 });
    await expect(lassiTicket).toBeVisible({ timeout: 20_000 });

    // Station tabs filter the board.
    await staff.getByRole('button', { name: 'Pantry', exact: true }).click();
    await expect(lassiTicket).toBeVisible();
    await expect(paneerTicket).toHaveCount(0);
    await staff.getByRole('button', { name: 'Tandoor & Breads', exact: true }).click();
    await expect(paneerTicket).toBeVisible();
    await expect(lassiTicket).toHaveCount(0);
    await staff.getByRole('button', { name: 'All', exact: true }).click();
    await expect(paneerTicket).toBeVisible();
    await expect(lassiTicket).toBeVisible();

    // Bump the item on the Tandoor ticket, then bump the ticket. It leaves the board.
    await paneerTicket.getByRole('button', { name: 'Bump Item' }).first().click();
    await expect(paneerTicket.getByText(/✓/)).toBeVisible();
    await shot(staff, 'journey3-item-bumped');
    await paneerTicket.getByRole('button', { name: 'Bump Ticket' }).click();
    await expect(paneerTicket).toHaveCount(0, { timeout: 15_000 });
    await expect(lassiTicket).toBeVisible();

    await shot(staff, 'journey3-after-ticket-bump');
    await staffContext.close();
    await guestContext.close();
  });
});
