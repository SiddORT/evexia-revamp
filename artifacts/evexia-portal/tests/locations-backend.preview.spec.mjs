import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { checkExportMenuStyles } from './helpers/export-menu-styles.mjs';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const key = 'evexia.admin.storage-locations.v1';
const legacy = '[{"id":"legacy-location","name":"Untouched local location","address":"Local only","status":"active"}]';
const locationFile = (name) => ({
  name: `${name}.csv`, mimeType: 'text/csv',
  buffer: Buffer.from(`Storage Location,Address,Status\n${name},Synthetic office,active`),
});
const downloadCount = (page) => page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(`${base()}/admin/masters/storage-locations`);
  await expect(page.getByTestId('text-storage-location-count')).toBeVisible();
}
test('location export menu preserves themed surfaces and keyboard highlights', async ({ page }) => {
  await open(page);
  await checkExportMenuStyles(page, 'button-export-storage-locations', 150);
});
async function create(page, name, address = 'Building A Ground floor') {
  await page.getByTestId('button-add-storage-location').click();
  await expect(page.getByText('Shared location directory only. Browser-local Allergen and purchasing locations are separate; no inventory is updated.', { exact: true })).toHaveCount(0);
  await page.getByTestId('input-storage-name').fill(name);
  await page.getByTestId('input-storage-address').fill(address);
  await page.getByTestId('select-storage-status').selectOption('active');
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/storage-locations' && response.request().method() === 'POST');
  await page.getByTestId('button-save-storage').click();
  const row = await (await response).json();
  await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toHaveText(name);
  return row;
}
for (const mobile of [false, true]) {
  test(`storage location ${mobile ? 'mobile' : 'desktop'} persistence, audit, conflict recovery and soft deletion`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Untouched local location', { exact: true })).toHaveCount(0);
    const name = mobile ? 'Mobile synthetic location' : 'Desktop synthetic location';
    const row = await create(page, name);
    const record = page.locator(mobile ? `[data-testid="card-storage-location-${row.id}"]` : 'tr')
      .filter({ has: page.getByTestId(`text-storage-location-name-${row.id}`) });
    await expect(record).toContainText('Super Admin');
    await expect(record).toContainText(row.address);
    const timestamp = await page.evaluate(async (at) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('dateFormat', 'yyyy-mm-dd');
      prefs.setAdminPreference('timeZone', 'UTC');
      prefs.setAdminPreference('clock', '24');
      return prefs.formatAdminTimestamp(at);
    }, row.createdAt);
    await expect(record).toContainText(timestamp);
    await page.getByTestId(`button-edit-storage-location-${row.id}`).click();
    await expect(page.getByTestId('input-storage-address')).toHaveValue(row.address);
    await page.getByTestId('input-storage-name').fill(name + ' edited');
    await page.getByTestId('input-storage-address').fill('Building B upstairs');
    await page.route(`**/api/v1/admin/storage-locations/${row.id}/edit?*`, (route) => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'location_unavailable', message: 'Persistence temporarily unavailable.' } }),
    }));
    await page.getByTestId('button-save-storage').click();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.getByTestId('input-storage-address')).toHaveValue('Building B upstairs');
    await page.unroute(`**/api/v1/admin/storage-locations/${row.id}/edit?*`);
    await page.evaluate(async (row) => {
      await (await import('/src/services/serverLocations.js')).editLocation(row, { name: row.name + ' concurrent', address: 'Current server address', status: 'active' });
    }, row);
    await page.getByTestId('button-save-storage').click();
    await expect(page.getByRole('alert')).toContainText('changed');
    await expect(page.getByTestId('button-save-storage')).toBeDisabled();
    await expect(page.getByTestId('input-storage-name')).toHaveValue(name + ' edited');
    await page.getByTestId('button-refresh-storage-error').click();
    await expect(page.getByRole('alert')).toContainText('Current server address');
    await expect(page.getByTestId('input-storage-address')).toHaveValue('Building B upstairs');
    await page.getByTestId('button-save-storage').click();
    await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toHaveText(name + ' edited');
    await page.getByTestId(`button-toggle-storage-location-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('select-filter-storage-locations').selectOption('inactive');
    await page.getByTestId('input-search-storage-locations').fill('Building B upstairs');
    await expect(page.getByTestId('text-storage-location-count')).toContainText('of 1');
    await page.getByTestId(`button-toggle-storage-location-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toHaveCount(0);
    await page.getByTestId('select-filter-storage-locations').selectOption('all');
    await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-delete-storage-location-${row.id}`).click();
    await expect(page.getByRole('dialog')).toContainText('Server deletion history is retained');
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-storage-location-name-${row.id}`)).toHaveCount(0);
    expect(await page.evaluate(async (id) => {
      try { await (await import('/src/services/serverLocations.js')).getLocation(id); return false; }
      catch (error) { return error.status === 404; }
    }, row.id)).toBe(true);
  });
}
test('location filtered full exports and explicit CSV/XLSX review and import', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await open(page);
  for (const suffix of ['alpha', 'beta', 'gamma']) await create(page, 'Location export synthetic ' + suffix, 'Export-only address');
  await page.getByTestId('input-search-storage-locations').fill('Export-only address');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.getByTestId('text-storage-location-count')).toContainText('of 3');
  await testInfo.attach('storage-location-filtered-table.png', {
    body: await page.screenshot(), contentType: 'image/png',
  });
  const beforeExports = await downloadCount(page);
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByTestId('button-export-storage-locations').click();
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename()).toBe(`evexia-storage-location-master.${format}`);
    const contents = await readFile(await result.path());
    if (format === 'csv') for (const suffix of ['alpha', 'beta', 'gamma']) expect(contents.toString()).toContain('Location export synthetic ' + suffix);
    else expect(contents.subarray(0, 2).toString()).toBe('PK');
  }
  expect(await downloadCount(page)).toBe(beforeExports + 2);
  await page.getByTestId('button-import-storage-locations').click();
  await expect(page).toHaveURL(/\/admin\/masters\/import\/storage-location$/);
  await expect(page.getByRole('button', { name: 'Storage Location Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.excel-import__card')).toHaveCount(2);
  await page.getByTestId('input-storage-import').setInputFiles({
    name: 'duplicates.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Storage Location,Address,Status\nDuplicate location,Office,active\nduplicate   location,Office,inactive'),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('button-confirm-storage-import')).toBeDisabled();
  await expect(page.getByTestId('storage-location-excel-report')).toContainText('Duplicate name within this file');
  await expect(page.locator('.excel-import__valid')).toHaveText('1 valid');
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await testInfo.attach('storage-location-import-review.png', {
    body: await page.screenshot(), contentType: 'image/png',
  });
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV sample' }).click();
  const csvSample = await csvDownload;
  expect(await readFile(await csvSample.path(), 'utf8')).toContain('Storage Location,Address,Status');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel sample' }).click();
  const sample = await download;
  expect((await readFile(await sample.path())).subarray(0, 2).toString()).toBe('PK');
  expect(await downloadCount(page)).toBe(beforeExports + 4);
  await page.getByTestId('input-storage-import').setInputFiles({
    name: 'template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(await sample.path()),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('button-confirm-storage-import')).toBeEnabled();
  expect(await page.evaluate(async () => (await (await import('/src/services/serverLocations.js')).listLocations({ query: 'Example supply room', status: 'all', limit: 10, offset: 0 })).filtered)).toBe(0);
  await page.getByTestId('button-confirm-storage-import').click();
  await expect(page.getByRole('status').filter({ hasText: '1 storage locations imported' })).toBeVisible();
  for (const [name, buffer] of [
    ['legacy.csv', 'Storage Location,Address,Status\nCSV legacy location,Legacy office,inactive'],
    ['backup.csv', '\uFEFFStorage Location,Address,Status,Created By,Created At,Updated By,Updated At\nCSV audit ignored,Audit office,Inactive,Forged,1900,Forged,1900'],
  ]) {
    await page.getByTestId('input-storage-import').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(buffer) });
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await expect(page.getByTestId('button-confirm-storage-import')).toBeEnabled();
    await page.getByTestId('button-confirm-storage-import').click();
    await expect(page.getByRole('status').filter({ hasText: 'imported into shared server records' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Back to Storage Location Master' }).click();
  await page.getByTestId('input-search-storage-locations').fill('CSV audit ignored');
  await expect(page.getByTestId('text-storage-location-count')).toContainText('of 1');
  await expect(page.locator('tr').filter({ hasText: 'CSV audit ignored' })).toContainText('Super Admin');
  await expect(page.locator('tr').filter({ hasText: 'CSV audit ignored' })).not.toContainText('Forged');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
});

test('location import rejects late reviews, consumes failed confirmations and preserves file drafts during renewal', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.getByTestId('button-import-storage-locations').click();
  const picker = page.getByTestId('input-storage-import');
  const upload = page.getByRole('button', { name: 'Upload & review', exact: true });
  const confirm = page.getByTestId('button-confirm-storage-import');
  await picker.setInputFiles(locationFile('Synthetic stale location review'));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/v1/admin/storage-locations/import/review?*', async (route) => {
    attempts++;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await upload.click();
  await expect(page.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reviewing…' }).dispatchEvent('click');
  await expect.poll(() => attempts).toBe(1);
  await picker.setInputFiles(locationFile('Synthetic replacement location'));
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('storage-location-excel-report')).toHaveCount(0);
  await expect(page.locator('.excel-import__picker')).toContainText('Synthetic replacement location.csv');
  await upload.click();
  await expect(confirm).toBeEnabled();
  let first = true;
  await page.route('**/api/v1/admin/storage-locations/import/review?*', (route) => {
    if (!first) return route.continue();
    first = false;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
  await upload.click();
  await expect(page.getByRole('alert')).toContainText('Session renewed. Your draft is preserved');
  expect(await picker.evaluate((node) => node.files[0].name)).toBe('Synthetic replacement location.csv');
  await page.unroute('**/api/v1/admin/storage-locations/import/review?*');
  await upload.click();
  await expect(confirm).toBeEnabled();
  await page.evaluate(async () => (await import('/src/services/serverLocations.js')).createLocation({
    name: 'Synthetic replacement location', address: 'Competing server office', status: 'inactive',
  }));
  await confirm.click();
  await expect(page.getByRole('alert')).toContainText('Review the file again');
  await expect(confirm).toHaveCount(0);
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await picker.evaluate((node) => { window.locationImportPicker = node; });
  await page.route('**/api/v1/auth/refresh', (route) => route.abort());
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByRole('button', { name: 'Retry session verification' })).toBeVisible();
  await expect(page.getByTestId('admin-session-content')).toBeHidden();
  await page.unroute('**/api/v1/auth/refresh');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(picker).toBeVisible();
  expect(await picker.evaluate((node) => node === window.locationImportPicker && node.files[0].name === 'Synthetic replacement location.csv')).toBe(true);
  await expect(confirm).toBeDisabled();

  await picker.setInputFiles(locationFile('Synthetic uncertain location import'));
  await upload.click();
  await expect(confirm).toBeEnabled();
  let commits = 0, finishCommit;
  const commitGate = new Promise((resolve) => { finishCommit = resolve; });
  await page.route('**/api/v1/admin/storage-locations/import/commit?*', async (route) => {
    commits++;
    await route.fetch();
    await commitGate;
    await route.abort('failed');
  });
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Importing…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Importing…' }).dispatchEvent('click');
  await expect(picker).toBeDisabled();
  await expect.poll(() => commits).toBe(1);
  finishCommit();
  await expect(page.getByRole('alert')).toContainText('Save outcome could not be confirmed');
  await expect(page.getByRole('alert')).toContainText('inspect shared records first');
  await expect(confirm).toHaveCount(0);
  await page.unroute('**/api/v1/admin/storage-locations/import/commit?*');
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(picker).toHaveCount(0);
});

test('location import route, master tabs and two cards work in desktop/mobile portal themes', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await open(page);
  await page.goto(`${base()}/admin/masters/import/storage-location`);
  await expect(page.getByRole('heading', { name: 'Import Storage Location data', exact: true })).toBeVisible();
  await page.getByTestId('input-storage-import').setInputFiles(locationFile('Long synthetic location filename '.repeat(6)));
  for (const [theme, appearance, width] of [['classic', 'light', 1440], ['classic', 'dark', 390], ['modern', 'light', 390], ['modern', 'dark', 1440]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async ({ theme, appearance }) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('theme', theme);
      prefs.setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const cards = page.locator('.excel-import__card');
    await expect(cards).toHaveCount(2);
    const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
    expect(width < 760 ? b.y > a.y + a.height : Math.abs(b.y - a.y) < 2).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`storage-import-${theme}-${appearance}-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
  for (const [tab, heading, preview] of [
    ['Zone Master', 'Import Zone data', false],
    ['Courier Partner Master', 'Import Courier Partner data', false],
    ['MR Master', 'Import MR data', false],
    ['Doctor Master', 'Import Doctor data', false],
    ['Storage Location Master', 'Import Storage Location data', false],
  ]) {
    await page.getByRole('navigation', { name: 'Select a master for import' }).getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(preview ? 'UI preview · Nothing will be saved' : 'Shared server records', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Back to Storage Location Master' }).click();
  await expect(page.getByTestId('text-storage-location-count')).toBeVisible();
});

test('location export menu keyboard, cancellation, pending focus, retry and late logout safety', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByTestId('button-export-storage-locations');
  let exports = 0, downloads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/admin/storage-locations/export') exports++; });
  page.on('download', () => downloads++);
  const before = await downloadCount(page);
  await expect(page.getByRole('combobox', { name: 'Location export format' })).toHaveCount(0);
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  const bounds = await page.getByRole('menu').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.locator('h1').click({ force: true });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(exports).toBe(0);
  expect(await downloadCount(page)).toBe(before);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/storage-locations/export?*', async (route) => {
    await held;
    await route.fulfill({ status: 503, json: { error: { code: 'location_unavailable', message: 'Synthetic export unavailable.' } } });
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  await expect(trigger).toBeDisabled();
  expect(await trigger.evaluate((node) => node.disabled)).toBe(false);
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await trigger.dispatchEvent('click');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => exports).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Export failed (Excel).');
  await expect(trigger).toBeEnabled();
  expect(await downloadCount(page)).toBe(before);
  await page.unroute('**/api/v1/admin/storage-locations/export?*');
  const download = page.waitForEvent('download');
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  await download;
  expect(await downloadCount(page)).toBe(before + 1);
  let finish, requested;
  const delayed = new Promise((resolve) => { finish = resolve; });
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route('**/api/v1/admin/storage-locations/export?*', async (route) => {
    const response = await route.fetch();
    requested();
    await delayed;
    await route.fulfill({ response });
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await started;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  finish();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  expect(downloads).toBe(1);
});

test('location sample logging fails closed, blocks duplicates and cancels handoff on route departure', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.getByTestId('button-import-storage-locations').click();
  const sample = page.getByRole('button', { name: 'Download CSV sample', exact: true });
  const before = await downloadCount(page);
  let downloads = 0, requests = 0, release;
  page.on('download', () => downloads++);
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/reporting/downloads/initiate', async (route) => {
    requests++;
    await held;
    await route.fulfill({ status: 503, json: { detail: 'Synthetic logging unavailable.' } });
  });
  await sample.click();
  await expect(sample).toBeDisabled();
  await sample.dispatchEvent('click');
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Sample download failed (CSV).');
  expect(downloads).toBe(0);
  expect(await downloadCount(page)).toBe(before);
  await page.unroute('**/reporting/downloads/initiate');
  const download = page.waitForEvent('download');
  await sample.click();
  await download;
  expect(await downloadCount(page)).toBe(before + 1);
  let finish, requested;
  const delayed = new Promise((resolve) => { finish = resolve; });
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route('**/reporting/downloads/initiate', async (route) => {
    const response = await route.fetch();
    requested();
    await delayed;
    await route.fulfill({ response });
  });
  await sample.click();
  await started;
  await page.getByRole('button', { name: 'Back to Storage Location Master' }).click();
  await expect(page.getByTestId('text-storage-location-count')).toBeVisible();
  finish();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(1);
});
test('location drafts survive same-route renewal and outage; logout clears protected drafts', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-storage-location').click();
  const input = page.getByTestId('input-storage-name');
  await input.fill('Synthetic location renewal draft');
  await page.getByTestId('input-storage-address').fill('Unsaved address');
  await page.evaluate(() => { window.locationDraftNode = document.getElementById('storage-name'); });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  await page.route('**/api/v1/auth/refresh', async (route) => { await gate; await route.continue(); });
  const renewal = page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('admin-session-content')).toBeHidden();
  await expect(input).toHaveValue('Synthetic location renewal draft');
  resume();
  await renewal;
  await expect(input).toBeVisible();
  await page.unroute('**/api/v1/auth/refresh');
  await page.route('**/api/v1/auth/refresh', (route) => route.abort());
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  await expect(input).toHaveValue('Synthetic location renewal draft');
  await page.unroute('**/api/v1/auth/refresh');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.locationDraftNode === document.getElementById('storage-name'))).toBe(true);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(input).toHaveCount(0);
});
