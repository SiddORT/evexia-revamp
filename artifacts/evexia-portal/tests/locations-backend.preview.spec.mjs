import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const key = 'evexia.admin.storage-locations.v1';
const legacy = '[{"id":"legacy-location","name":"Untouched local location","address":"Local only","status":"active"}]';
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
async function create(page, name, address = 'Building A Ground floor') {
  await page.getByTestId('button-add-storage-location').click();
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
  await open(page);
  for (const suffix of ['alpha', 'beta', 'gamma']) await create(page, 'Location export synthetic ' + suffix, 'Export-only address');
  await page.getByTestId('input-search-storage-locations').fill('Export-only address');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.getByTestId('text-storage-location-count')).toContainText('of 3');
  await testInfo.attach('storage-location-filtered-table.png', {
    body: await page.screenshot(), contentType: 'image/png',
  });
  for (const format of ['csv', 'xlsx']) {
    await page.getByLabel('Location export format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.getByTestId('button-export-storage-locations').click();
    const result = await download;
    expect(result.suggestedFilename()).toBe(`evexia-storage-location-master.${format}`);
    const contents = await readFile(await result.path());
    if (format === 'csv') for (const suffix of ['alpha', 'beta', 'gamma']) expect(contents.toString()).toContain('Location export synthetic ' + suffix);
    else expect(contents.subarray(0, 2).toString()).toBe('PK');
  }
  await page.getByTestId('button-import-storage-locations').click();
  await page.getByTestId('input-storage-import').setInputFiles({
    name: 'duplicates.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Storage Location,Address,Status\nDuplicate location,Office,active\nduplicate   location,Office,inactive'),
  });
  await page.getByRole('button', { name: 'Review file', exact: true }).click();
  await expect(page.getByTestId('button-confirm-storage-import')).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Duplicate name within this file');
  await testInfo.attach('storage-location-import-review.png', {
    body: await page.screenshot(), contentType: 'image/png',
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel template' }).click();
  const sample = await download;
  await page.getByTestId('input-storage-import').setInputFiles({
    name: 'template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(await sample.path()),
  });
  await page.getByRole('button', { name: 'Review file', exact: true }).click();
  await expect(page.getByTestId('button-confirm-storage-import')).toBeEnabled();
  expect(await page.evaluate(async () => (await (await import('/src/services/serverLocations.js')).listLocations({ query: 'Example supply room', status: 'all', limit: 10, offset: 0 })).filtered)).toBe(0);
  await page.getByTestId('button-confirm-storage-import').click();
  await expect(page.getByRole('dialog')).toContainText('1 storage locations saved to the shared database');
  for (const [name, buffer] of [
    ['legacy.csv', 'Storage Location,Address,Status\nCSV legacy location,Legacy office,inactive'],
    ['backup.csv', '\uFEFFStorage Location,Address,Status,Created By,Created At,Updated By,Updated At\nCSV audit ignored,Audit office,Inactive,Forged,1900,Forged,1900'],
  ]) {
    await page.getByTestId('input-storage-import').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(buffer) });
    await page.getByRole('button', { name: 'Review file', exact: true }).click();
    await expect(page.getByTestId('button-confirm-storage-import')).toBeEnabled();
    await page.getByTestId('button-confirm-storage-import').click();
    await expect(page.getByRole('dialog')).toContainText('saved to the shared database');
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('input-search-storage-locations').fill('CSV audit ignored');
  await expect(page.getByTestId('text-storage-location-count')).toContainText('of 1');
  await expect(page.locator('tr').filter({ hasText: 'CSV audit ignored' })).toContainText('Super Admin');
  await expect(page.locator('tr').filter({ hasText: 'CSV audit ignored' })).not.toContainText('Forged');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
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
