import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: ['**/purchase-orders-backend.smoke.spec.mjs', '**/purchase-orders-mutations.spec.mjs', '**/purchase-orders-tax.spec.mjs'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  use: {
    headless: true,
    launchOptions: {
      ...(process.env.EVEXIA_CHROMIUM_PATH ? { executablePath: process.env.EVEXIA_CHROMIUM_PATH } : {}),
      args: ['--no-sandbox'],
    },
  },
});
