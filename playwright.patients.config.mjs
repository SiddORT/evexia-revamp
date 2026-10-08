import { defineConfig } from '@playwright/test';
import engines from './playwright.downloads.config.mjs';

// Reuse the current-engine launch environments, without spec-level Chromium
// overrides. Sequential projects preserve the real single-session policy.
export default defineConfig({
  ...engines,
  testMatch: '**/patients-layout.preview.spec.mjs',
  ...(process.env.EVEXIA_PATIENT_LAYOUT_GREP ? { grep: new RegExp(process.env.EVEXIA_PATIENT_LAYOUT_GREP) } : {}),
  maxFailures: Number(process.env.EVEXIA_PATIENT_LAYOUT_MAX_FAILURES || 0),
  projects: engines.projects.map((project) => ({
    ...project, name: project.name.replace('downloads-', 'patients-'),
  })),
});
