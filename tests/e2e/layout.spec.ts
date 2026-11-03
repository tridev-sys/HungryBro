import { test, expect } from '@playwright/test';

test('no horizontal page scroll at 320 px (Review Focus 1)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/dev/dine-in-preview');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('payment button is fully on screen at 390×844 (Review Focus 2)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/dine-in-preview');
  const box = await page.getByRole('button', { name: /PAY/ }).boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
});

test('laptop shows two columns at 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/dev/dine-in-preview');
  await page.screenshot({ path: 'test-results/laptop.png', fullPage: true });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="screen-columns"]')!).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
});
