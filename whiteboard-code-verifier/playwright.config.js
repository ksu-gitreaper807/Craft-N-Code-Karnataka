import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8878',
    viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.mjs',
    env: { PORT: '8878', SNAPSHOT_DIR: 'test-results/lesson-snapshots' },
    url: 'http://127.0.0.1:8878',
    reuseExistingServer: false,
  },
});
