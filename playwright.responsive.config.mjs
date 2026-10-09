import { defineConfig } from '@playwright/test';
import shared from './playwright.downloads.config.mjs';

export default defineConfig({
  ...shared,
  testMatch: '**/portal-responsive.preview.spec.mjs',
  timeout: 900_000,
  use: { ...shared.use, actionTimeout: 20_000, navigationTimeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: process.env.EVEXIA_RESPONSIVE_RESULT || 'test-results/responsive-summary.json' }]],
  projects: shared.projects
    .filter((project) => project.use.browserName !== 'webkit' || process.env.EVEXIA_RESPONSIVE_INCLUDE_WEBKIT === '1')
    .filter((project) => !process.env.EVEXIA_RESPONSIVE_ENGINE || project.use.browserName === process.env.EVEXIA_RESPONSIVE_ENGINE)
    .map((project) => ({ ...project, name: project.name.replace('downloads-', 'responsive-') })),
});
