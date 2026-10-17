import { defineConfig } from '@playwright/test';
import engines from './playwright.downloads.config.mjs';

if (process.env.EVEXIA_ROLE_URL_LAYOUT_PREVIEW !== '1') {
  throw new Error('Run Role URLs layout through scripts/run-role-url-layout-previews.sh.');
}

export default defineConfig({
  ...engines,
  testMatch: '**/role-urls-layout.preview.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: engines.projects.map((project) => ({
    ...project, name: project.name.replace('downloads-', 'role-urls-layout-'),
  })),
});
