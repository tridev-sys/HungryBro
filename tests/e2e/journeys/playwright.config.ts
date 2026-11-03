import { defineConfig } from '@playwright/test';

// Customer-journey runner. Runs inside the official Playwright image against the e2e app container.
// BASE_URL is the app container address on e2e-net. Chromium is told to treat that origin as secure
// because the app sets Secure cookies (fos_session, fos_table_session) and the test network is plain HTTP.
const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL is required (the e2e app container, for example http://172.20.0.5:3000)');

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '/tmp/pw-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // The full Chromium build honours --unsafely-treat-insecure-origin-as-secure. The headless shell
        // ignores it, so Secure cookies would be dropped on this plain-HTTP test network.
        channel: 'chromium',
        launchOptions: {
          args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(BASE_URL).origin}`],
        },
      },
    },
  ],
});
