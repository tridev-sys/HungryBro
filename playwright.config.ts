import { defineConfig, devices } from '@playwright/test';

// Base URL precedence: E2E_BASE_URL (CI and the shared network: http://food-os-app:3000), then
// BASE_URL (a production build run in a container). When either is set, no dev server is started.
// Without them, a local dev server is started on port 3100 (used by the dev-preview layout specs).
const LOCAL_PORT = 3100;
const externalBase = process.env.E2E_BASE_URL ?? process.env.BASE_URL;
const baseURL = externalBase ?? `http://localhost:${LOCAL_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
  outputDir: 'test-results',
  // No retries: flaky timing belongs in the test, not hidden by retries.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: externalBase
    ? undefined
    : {
        command: `npx next dev -p ${LOCAL_PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  // Same browser setup as tests/e2e/journeys/playwright.config.ts. The app sets Secure cookies
  // (fos_session, fos_table_session), and the test network is plain HTTP. Only the full Chromium
  // build honours --unsafely-treat-insecure-origin-as-secure; the headless shell drops those cookies.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 7'],
        channel: 'chromium',
        launchOptions: {
          args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`],
        },
      },
    },
  ],
});
