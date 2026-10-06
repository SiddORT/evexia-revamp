import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');

test('pending editor chunk waits accessibly and only downloads after authorization', async ({ page }) => {
  await authenticateAdmin(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await hold;
    await route.continue();
  });
  let releaseChunk;
  const chunkHold = new Promise((resolve) => { releaseChunk = resolve; });
  await page.route('**/src/pages/admin/PatientFormPage.jsx*', async (route) => {
    requested = true;
    await chunkHold;
    await route.continue();
  });
  await page.goto(`${base()}/admin/masters/patients/new`, { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByTestId('portal-loader').getByRole('status')).toHaveText('Checking Admin access…');
    expect(requested).toBe(false);
    await expect(page.getByTestId('admin-session-content')).toBeEmpty();
    release();
    await expect(page.getByTestId('portal-loader').getByRole('status')).toHaveText('Opening page…');
    expect(requested).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.locator('.portal-loader__brand').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.getByTestId('img-evexia-logo')).toHaveAttribute('src', /images\/evexia-logo\.png$/);
  } finally {
    release();
    releaseChunk();
  }
  await expect(page.getByTestId('input-patient-name')).toBeVisible();
  await expect(page.getByTestId('portal-loader')).toHaveCount(0);
});

test('chunk failure is an actionable error, not pending, and reload recovers', async ({ page }) => {
  await authenticateAdmin(page);
  await page.route('**/src/pages/admin/PatientFormPage.jsx*', (route) => route.abort());
  await page.goto(`${base()}/admin/masters/patients/new`);
  await expect(page.getByRole('alert')).toContainText('Could not download this page');
  await expect(page.getByTestId('portal-loader')).toHaveCount(0);
  await expect(page.getByTestId('input-patient-name')).toHaveCount(0);
  await expect(page.getByText('Reloading will discard any unsaved changes in this tab.')).toBeVisible();
  await page.unroute('**/src/pages/admin/PatientFormPage.jsx*');
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await expect(page.getByTestId('input-patient-name')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('heavy route deep links retain path, parameters and settings query', async ({ page }) => {
  test.setTimeout(120_000);
  await authenticateAdmin(page);
  for (const path of [
    '/admin/settings?tab=ui',
    '/admin/inventory/purchase-orders/new',
    '/admin/inventory/purchase-received/new',
    '/admin/masters/import/doctor',
    '/admin/masters/doctors/new',
    '/admin/masters/doctors/synthetic-missing/payments',
    '/admin/masters/mrs/new',
    '/admin/masters/patients/import',
    '/admin/activity-logs',
  ]) {
    await page.goto(`${base()}${path}`);
    await expect(page.getByTestId('button-admin-profile'), `deep link ${path}`).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('portal-loader')).toHaveCount(0);
    expect(page.url()).toBe(`${base()}${path}`);
    if (path.endsWith('/import/doctor')) {
      await expect(page.getByRole('heading', { name: 'Import Doctor data', exact: true })).toBeVisible();
    }
    if (path.endsWith('?tab=ui')) {
      await expect(page.getByTestId('link-settings-ui')).toHaveAttribute('aria-current', 'page');
    }
  }
});
