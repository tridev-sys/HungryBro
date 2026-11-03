import { test, expect, type Page } from '@playwright/test';

// The preview page must really render before any measurement. A 404 page has
// neither the h1 nor the screen-columns test id, so these checks fail on a 404.
async function openPreview(page: Page) {
  await page.goto('/dev/dine-in-preview');
  await expect(page.getByRole('heading', { level: 1, name: 'AUTONOMOUS FOOD OS' })).toBeVisible();
  await expect(page.getByTestId('screen-columns')).toBeVisible();
}

test('no horizontal page scroll at 320 px (Review Focus 1)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openPreview(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('payment button is fully on screen at 390×844 (Review Focus 2)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview(page);
  const box = await page.getByRole('button', { name: /PAY/ }).boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
});

test('laptop shows two columns at 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openPreview(page);
  await page.screenshot({ path: 'test-results/laptop.png', fullPage: true });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="screen-columns"]')!).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
});
