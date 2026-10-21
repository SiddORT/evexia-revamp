import { defineConfig } from '@playwright/test';
import shared from './playwright.downloads.config.mjs';

// Reuse the current, matching engine configuration; missing engines fail.
// WebKit is engine evidence, not a native Safari/macOS file-picker test.
export default defineConfig({
  ...shared,
  testMatch: '**/opening-stock.preview.spec.mjs',
  timeout: 180_000,
  maxFailures: 1,
  // Resume an interrupted matrix without repeating completed journeys.
  grepInvert: process.env.EVEXIA_OPENING_STOCK_SKIP ? new RegExp(process.env.EVEXIA_OPENING_STOCK_SKIP) : undefined,
  use: { actionTimeout: 20_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: shared.projects.map(project => ({ ...project, name: project.name.replace('downloads-', 'opening-stock-') })),
});
