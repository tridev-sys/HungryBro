import { defineConfig } from '@playwright/test';

// Separate config so the a11y suite runs only tests/a11y against an already-running server (BASE_URL).
export default defineConfig({
  testDir: '.',
  testMatch: /a11y\.spec\.ts/,
  outputDir: '../../test-results/a11y/output',
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
