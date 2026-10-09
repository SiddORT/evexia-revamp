import { defineConfig } from '@playwright/test';
import engines from './playwright.downloads.config.mjs';

if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') {
  throw new Error('Run Sales Target previews through scripts/run-authenticated-previews.sh.');
}
process.env.EVEXIA_SALES_TARGET_MATRIX = '1';

export default defineConfig({
  ...engines,
  testMatch: '**/sales-targets-backend.preview.spec.mjs',
  grep: new RegExp(process.env.EVEXIA_SALES_TARGET_LAYOUT_GREP || '@sales-target-layout'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A failed case restarts the worker and legitimately consumes another MR
  // provisioning slot. Fail once instead of masking a layout fault with a
  // cascade of synthetic credential-budget errors.
  maxFailures: Number(process.env.EVEXIA_SALES_TARGET_LAYOUT_MAX_FAILURES || 1),
  projects: engines.projects.map((project) => ({
    ...project, name: project.name.replace('downloads-', 'sales-targets-'),
    use: { ...project.use, actionTimeout: 15000, navigationTimeout: 30000, trace: 'retain-on-failure' },
  })),
});
