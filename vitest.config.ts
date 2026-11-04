import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, 'node_modules/server-only/empty.js') },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: true,
    fileParallelism: false,
    // Creates a per-run database (food_os_test_<runid>) and drops it after the run.
    globalSetup: ['tests/setup/test-database.ts'],
    setupFiles: ['tests/setup.ts', 'tests/setup/no-network.ts', 'tests/setup/pos-key.ts'],
  },
});
