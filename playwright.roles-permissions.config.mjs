import { defineConfig } from '@playwright/test';
import engines from './playwright.downloads.config.mjs';

// This matrix must never target a configured account/database. The harness
// supplies private listeners, disposable PostgreSQL and synthetic credentials.
if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') {
  throw new Error('Run the Roles and Permissions matrix through scripts/run-authenticated-previews.sh.');
}

export default defineConfig({
  ...engines,
  testMatch: '**/roles-permissions.preview.spec.mjs',
  grep: new RegExp('@roles-layout' + (process.env.EVEXIA_ROLES_LAYOUT_GREP ? `.*${process.env.EVEXIA_ROLES_LAYOUT_GREP}` : '')),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: engines.projects.map((project) => ({
    ...project, name: project.name.replace('downloads-', 'roles-permissions-'),
  })),
});
