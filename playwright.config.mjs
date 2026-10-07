import { defineConfig } from '@playwright/test';

// Authenticated previews start cold Vite/SQL fixtures and can share CPU with
// other workspace checks. Wait for real readiness, not a five-second startup
// assumption. Exact assertions and negative authorization tests remain intact.
export default defineConfig({
  testMatch: '**/*.preview.spec.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
});
