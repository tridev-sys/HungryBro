// Shared helpers for the journey specs. Imports only Node built-ins and @playwright/test, so the
// spec run does not depend on the app's own dependency tree.
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';

export interface Fixture {
  run: string;
  dine: { restaurantId: string; name: string; tables: Record<string, string> };
  otherRestaurant: { restaurantId: string; name: string };
  kitchens: Array<{ restaurantId: string; name: string }>;
  menu: { paneerTikka: string; vegSeekh: string; dalMakhani: string; chickenBiryani: string; mangoLassi: string };
  diner: { id: string; sessionToken: string };
  staffA: { id: string; sessionToken: string };
  staffB: { id: string; sessionToken: string };
  rating: { tableNumber: string; tableSessionToken: string; raterSessionToken: string; bystanderSessionToken: string };
}

export const fixture: Fixture = JSON.parse(
  readFileSync(process.env.E2E_FIXTURE_FILE ?? '/out/fixtures.json', 'utf8'),
);

export const SHOT_DIR = process.env.E2E_SHOT_DIR ?? 'test-results';
mkdirSync(SHOT_DIR, { recursive: true });

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
}

/** Attaches a signed-in session cookie (the token the sign-in flow issues) to a browser context. */
export async function signIn(context: BrowserContext, token: string): Promise<void> {
  const origin = process.env.BASE_URL ?? '';
  await context.addCookies([
    { name: 'fos_session', value: token, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/** Attaches the table session cookie (fos_table_session), the token the table QR flow issues. */
export async function signInTable(context: BrowserContext, token: string): Promise<void> {
  const origin = process.env.BASE_URL ?? '';
  await context.addCookies([
    { name: 'fos_table_session', value: token, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}
