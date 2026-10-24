import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3100';
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4801';
const CI = Boolean(process.env.CI);

/**
 * Runs against a production build (`npm run e2e:build -w frontend`) and an API booted on an
 * in-memory replica set with the demo seed (`npm run e2e:api -w backend`).
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run e2e:api -w backend',
      cwd: '..',
      url: `${API}/api/v1/products?limit=1`,
      timeout: 180_000,
      reuseExistingServer: !CI,
    },
    {
      command: 'npx next start -H 127.0.0.1 -p 3100',
      url: WEB,
      timeout: 120_000,
      reuseExistingServer: !CI,
      env: { STOREFRONT_REVALIDATE_SECRET: 'e2e-revalidate-secret-0123', NEXT_PUBLIC_API_URL: API },
    },
  ],
});
