import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const legacy = '[{"name":"Untouched legacy marker","id":"sample-staff-1"}]';

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(async (raw) => {
    localStorage.setItem('evexia.admin.staff.v1', raw);
    const { loadDesignations, createDesignation } = await import('/src/services/designations.js');
    const items = loadDesignations();
    if (!items.some((row) => row.name === 'Synthetic Executive')) createDesignation(items, { name: 'Synthetic Executive', shortName: 'SE', level: 1, status: 'active' });
  }, legacy);
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
}
async function fill(page, suffix, country = 'IN', phone = '9876543210') {
  await page.getByTestId('input-staff-name').fill(`Fictional ${suffix}`);
  await page.getByTestId('input-staff-email').fill(`fictional-${suffix}@example.com`);
  await page.getByTestId('input-staff-phone').fill(phone);
  await page.getByLabel('Phone country code').selectOption(country);
  await page.getByTestId('select-staff-designation').selectOption('Synthetic Executive');
  await page.getByTestId('input-staff-dateOfJoining').fill('2025-01-15');
}
async function create(page, suffix, country, phone) {
  await page.getByTestId('button-add-staff').click();
  await expect(page.getByTestId('input-staff-userId')).toHaveValue('');
  await expect(page.getByTestId('input-staff-userId')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('input-staff-password')).toHaveCount(0);
  await expect(page.getByTestId('checkbox-staff-invitation')).toHaveCount(0);
  await fill(page, suffix, country, phone);
  const response = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/staff') && response.request().method() === 'POST');
  await page.getByTestId('button-save-staff').click();
  const saved = await (await response).json();
  await expect(page.getByRole('dialog')).toContainText('One-time staff credentials');
  await expect(page.getByTestId('text-staff-credential-password')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('text-staff-credential-id')).toHaveValue(saved.record.userId);
  await page.getByTestId('button-reveal-staff-credentials').click();
  await expect(page.getByTestId('text-staff-credential-password')).toHaveValue(saved.initial_password);
  return saved;
}

test('empty database never renders or imports local staff; server credentials, edits, stale conflicts and exports are safe', async ({ page, context }) => {
  await open(page);
  await expect(page.getByTestId('status-staff-empty')).toContainText('No staff members yet');
  await expect(page.getByText('Untouched legacy marker')).toHaveCount(0);
  await expect(page.getByTestId('button-import-staff')).toBeDisabled();
  const saved = await create(page, 'desktop');
  const row = saved.record;
  expect(row.userId).toMatch(/^st_[a-f0-9]{28}$/);
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stores).not.toContain(saved.initial_password);
  expect(stores).not.toContain('fictional-desktop@example.com');
  expect(stores).not.toContain('9876543210');
  await page.getByTestId('button-close-staff-credentials').click();
  await page.reload();
  await expect(page.getByTestId(`text-staff-name-${row.id}`)).toHaveText('Fictional desktop');
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  await page.getByTestId(`button-edit-staff-${row.id}`).click();
  await expect(page.getByTestId('input-staff-userId')).toHaveValue(row.userId);
  await page.getByTestId('input-staff-name').fill('Fictional desktop revised');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`text-staff-name-${row.id}`)).toHaveText('Fictional desktop revised');
  await page.getByTestId(`button-edit-staff-${row.id}`).click();
  await page.getByTestId('input-staff-name').fill('Preserved stale draft');
  const other = await context.newPage();
  await other.goto(`${base()}/admin/staff`);
  await expect(other.getByTestId(`switch-staff-status-${row.id}`)).toBeVisible();
  await other.getByTestId(`switch-staff-status-${row.id}`).click();
  await expect(other.getByTestId(`switch-staff-status-${row.id}`)).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('record changed');
  await expect(page.getByTestId('input-staff-name')).toHaveValue('Preserved stale draft');
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await page.getByRole('button', { name: 'Review current record' }).click();
  await expect(page.getByRole('dialog')).toContainText('Fictional desktop revised');
  await page.getByTestId('button-cancel-staff').click();
  await other.close();
  await page.reload();
  await expect(page.getByTestId(`switch-staff-status-${row.id}`)).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('input-search-staff').fill(row.userId);
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  expect(csv).toContain(row.userId);
  expect(csv).not.toContain(saved.initial_password);
  expect(csv).not.toContain(row.id);
  expect(csv).not.toMatch(/password|hash|createdBy/i);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
  await page.screenshot({ path: '/tmp/evexia-staff-backend-desktop.png', fullPage: true });
});

test('retryable failures preserve drafts; ambiguous creates are not repeated; duplicate emails reject on server', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-staff').click();
  await fill(page, 'failure');
  const outage = (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'staff_unavailable' } }) }) : route.continue();
  await page.route('**/api/v1/admin/staff', outage);
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('unavailable');
  await expect(page.getByTestId('input-staff-name')).toHaveValue('Fictional failure');
  await expect(page.getByTestId('button-save-staff')).toBeEnabled();
  await page.unroute('**/api/v1/admin/staff', outage);
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByRole('dialog')).toContainText('One-time staff credentials');
  await page.getByTestId('button-close-staff-credentials').click();
  await page.getByTestId('button-add-staff').click();
  await fill(page, 'failure');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('already exists');
  await page.getByTestId('input-staff-email').fill('fictional-ambiguous@example.com');
  let writes = 0;
  await page.route('**/api/v1/admin/staff', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes += 1;
    await route.abort('failed');
  });
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('outcome could not be confirmed');
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await expect(page.getByTestId('input-staff-email')).toHaveValue('fictional-ambiguous@example.com');
  expect(writes).toBe(1);
});

test('shared mobile form retains phone countries and clears one-time credentials on navigation and logout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  for (const [country, phone, full] of [['US', '2025550123', '+12025550123'], ['GB', '7700900123', '+447700900123'], ['AE', '501234567', '+971501234567']]) {
    const saved = await create(page, `mobile-${country}`, country, phone);
    await page.getByTestId('button-close-staff-credentials').click();
    const record = saved.record;
    await expect(page.getByTestId(`link-staff-mobile-phone-${record.id}`)).toHaveText(full);
    await page.getByTestId(`card-staff-${record.id}`).getByRole('button', { name: `Edit ${record.name}`, exact: true }).click();
    await expect(page.getByTestId('input-staff-userId')).toHaveValue(record.userId);
    await expect(page.getByLabel('Phone country code')).toHaveValue(country);
    for (const control of [page.getByTestId('input-staff-userId'), page.getByTestId('input-staff-phone'), page.getByLabel('Phone country code')]) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    await page.getByTestId('button-cancel-staff').click();
  }
  await create(page, 'navigation');
  await page.goto(`${base()}/admin`);
  // A full navigation restores/rotates the refresh cookie. Do not interrupt it
  // with another hard navigation before the new authenticated page is ready.
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  await create(page, 'session-end');
  // End the actual session from another tab, while the credential dialog is open.
  const other = await page.context().newPage();
  await other.goto(`${base()}/admin`);
  await expect(other.getByTestId('button-admin-profile')).toBeVisible();
  await other.evaluate(async () => { const { logoutAdmin } = await import('/src/auth/adminSession.js'); await logoutAdmin(); });
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
});

test('directory search finds beyond the loaded batch, continues empty sections, retries and never stores terms', async ({ page }) => {
  execFileSync('python3', ['scripts/seed-staff-search-preview.py']);
  await open(page);
  await expect(page.getByText('Directory Preview 605', { exact: true })).toHaveCount(0);
  const input = page.getByTestId('input-directory-search-staff');
  await input.fill('preview-search-605@example.com');
  const requestEvent = page.waitForRequest((request) => request.url().endsWith('/api/v1/admin/staff/search'));
  await page.getByTestId('button-directory-search-staff').click();
  const request = await requestEvent;
  expect(request.method()).toBe('POST');
  expect(request.url()).not.toContain('preview-search-605');
  expect(request.postDataJSON().query).toBe('preview-search-605@example.com');
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await expect(page.getByTestId('status-staff-empty')).toContainText('No matches in this section');
  await expect(page.getByTestId('button-continue-directory-search-staff')).toBeEnabled();
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByText('Directory Preview 605', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('Search complete');
  await expect(page.getByTestId('button-continue-directory-search-staff')).toBeDisabled();
  await expect(page.getByTestId('button-previous-directory-search-staff')).toBeEnabled();
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  expect(csv).toContain('preview-search-605@example.com');
  expect(csv).not.toContain('preview-search-604@example.com');
  await page.getByTestId('button-previous-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await expect(page.getByTestId('button-previous-directory-search-staff')).toBeDisabled();
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByText('Directory Preview 605', { exact: true }).first()).toBeVisible();
  const snapshot = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(snapshot).not.toContain('preview-search-605');
  expect(snapshot).not.toContain('Directory Preview');
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
  await page.screenshot({ path: '/tmp/evexia-staff-directory-search.png', fullPage: true });
  await input.fill('not-present-in-directory');
  let fail = true;
  await page.route('**/api/v1/admin/staff/search', (route) => {
    if (fail) { fail = false; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"staff_unavailable"}}' }); }
    return route.continue();
  });
  await page.getByTestId('button-directory-search-staff').click();
  await expect(page.getByTestId('button-retry-staff')).toBeVisible();
  await expect(page.getByTestId('button-export-staff')).toBeDisabled();
  await page.getByTestId('button-retry-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('Search complete');
  await expect(page.getByTestId('status-staff-empty')).toContainText('No matches in this final section');
  await page.getByTestId('button-clear-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toHaveCount(0);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Next batch', exact: true })).toBeEnabled();
});
