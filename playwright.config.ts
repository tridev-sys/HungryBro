import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL points at a running app (CI and the shared network: http://food-os-app:3000).
// Without it, a local dev server is started on port 3100 (used by the dev-preview layout specs).
const LOCAL_PORT = 3100;
const base = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
  outputDir: 'test-results',
  // No retries: flaky timing belongs in the test, not hidden by retries.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: base ?? `http://localhost:${LOCAL_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: base
    ? undefined
    : {
        command: `npx next dev -p ${LOCAL_PORT}`,
        url: `http://localhost:${LOCAL_PORT}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
});
