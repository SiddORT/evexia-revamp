import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const legacy = '[{"id":"legacy-zone","name":"Untouched local zone","status":"active"}]';

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate((value) => localStorage.setItem('evexia.admin.zones.v1', value), legacy);
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByRole('status').filter({ hasText: 'Loading shared zones' })).toHaveCount(0);
}

async function create(page, name) {
  await page.getByTestId('button-add-zone').click();
  await page.getByLabel('Zone name *').fill(name);
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/zones' && response.request().method() === 'POST');
  await page.getByTestId('button-save-zone').click();
  const record = await (await response).json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`text-zone-name-${record.id}`)).toHaveText(name);
  return record;
}

for (const mobile of [false, true]) {
  test(`shared zones ${mobile ? 'mobile' : 'desktop'} CRUD, audit, filters and browser-local isolation`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Untouched local zone', { exact: true })).toHaveCount(0);
    const prefix = mobile ? 'Mobile synthetic zone' : 'Desktop synthetic zone';
    const row = await create(page, prefix);
    const record = page.locator(mobile ? `[data-testid="card-zone-${row.id}"]` : 'tr').filter({ has: page.getByTestId(`text-zone-name-${row.id}`) });
    await expect(record).toContainText('Super Admin');
    await expect(record).not.toContainText('Admin User');
    const displayed = await page.evaluate(async (at) => {
      const preferences = await import('/src/components/admin/adminPreferences.js');
      preferences.setAdminPreference('dateFormat', 'yyyy-mm-dd');
      preferences.setAdminPreference('timeZone', 'UTC');
      preferences.setAdminPreference('clock', '24');
      return preferences.formatAdminTimestamp(at);
    }, row.createdAt);
    await expect(record).toContainText(displayed);
    await page.getByTestId(`button-edit-zone-${row.id}`).click();
    await page.getByLabel('Zone name *').fill(prefix + ' edited');
    // Recoverable persistence errors preserve the mounted draft.
    await page.route(`**/api/v1/admin/zones/${row.id}/edit?*`, (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'zone_unavailable', message: 'Persistence temporarily unavailable.' } }),
    }));
    await page.getByTestId('button-save-zone').click();
    await expect(page.getByRole('dialog')).toContainText('temporarily unavailable');
    await expect(page.getByLabel('Zone name *')).toHaveValue(prefix + ' edited');
    await page.unroute(`**/api/v1/admin/zones/${row.id}/edit?*`);
    await page.getByTestId('button-save-zone').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveText(prefix + ' edited');
    await page.getByTestId(`button-toggle-zone-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('select-filter-zones').selectOption('inactive');
    await page.getByTestId('input-search-zones').fill(prefix);
    await expect(page.getByTestId('text-zone-count')).toContainText('of 1');
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('evexia.admin.zones.v1'))).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-delete-zone-${row.id}`).click();
    await expect(page.getByRole('dialog')).toContainText('Server deletion history is retained');
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveCount(0);
    // Inspector uses the existing memory-only request layer; no bearer escapes.
    const deleted = await page.evaluate(async (id) => {
      try { await (await import('/src/services/serverZones.js')).getZone(id); return false; }
      catch (error) { return error.status === 404; }
    }, row.id);
    expect(deleted).toBe(true);
  });
}

test('review is inert, duplicate rows block confirmation, CSV/XLSX transfers and complete filtered exports', async ({ page }) => {
  await open(page);
  await create(page, 'Export synthetic alpha');
  await create(page, 'Export synthetic beta');
  await create(page, 'Export synthetic gamma');
  await page.getByTestId('input-search-zones').fill('Export synthetic');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.getByTestId('text-zone-count')).toContainText('of 3');
  const downloadCSV = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  const csv = await downloadCSV;
  expect(csv.suggestedFilename()).toBe('evexia-zone-master.csv');
  const content = await readFile(await csv.path(), 'utf8');
  for (const name of ['alpha', 'beta', 'gamma']) expect(content).toContain(`Export synthetic ${name}`);
  expect(content).not.toContain('Untouched local zone');
  expect(content).toContain('Super Admin');
  await page.getByLabel('Zone export format').selectOption('xlsx');
  const downloadXLSX = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  const xlsx = await downloadXLSX;
  expect(xlsx.suggestedFilename()).toBe('evexia-zone-master.xlsx');
  expect((await readFile(await xlsx.path())).subarray(0, 2).toString()).toBe('PK');
  await page.getByTestId('button-import-zones').click();
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'duplicates.csv', mimeType: 'text/csv', buffer: Buffer.from('Zone Name,Status\nDuplicate synthetic,active\nduplicate synthetic,active'),
  });
  await page.getByRole('button', { name: 'Review file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 zones' })).toBeDisabled();
  await expect(page.getByText('Duplicate name within this file.')).toBeVisible();
  const sampleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel sample' }).click();
  const sample = await sampleDownload;
  // Playwright path has a generated filename; provide the genuine downloaded
  // workbook explicitly with the required .xlsx extension.
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await sample.path()),
  });
  await page.getByRole('button', { name: 'Review file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 zones' })).toBeEnabled();
  const countBefore = await page.evaluate(async () => (await (await import('/src/services/serverZones.js')).listZones({ query: 'Example', status: 'all', limit: 10, offset: 0 })).filtered);
  expect(countBefore).toBe(0);
  await page.getByRole('button', { name: 'Confirm import of 2 zones' }).click();
  await expect(page.getByRole('status')).toContainText('2 zones imported');
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFFZone Name,Status,Created By,Created At,Updated By,Updated At\nCSV synthetic,Inactive,Forged,1900,Forged,1900'),
  });
  await page.getByRole('button', { name: 'Review file', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm import of 1 zones' }).click();
  await expect(page.getByRole('status')).toContainText('1 zones imported');
  await page.getByRole('button', { name: 'Back to Zone Master' }).click();
  await page.getByTestId('input-search-zones').fill('CSV synthetic');
  await expect(page.getByTestId('text-zone-count')).toContainText('of 1');
  await expect(page.locator('tr').filter({ hasText: 'CSV synthetic' })).toContainText('Super Admin');
  await expect(page.locator('tr').filter({ hasText: 'CSV synthetic' })).not.toContainText('Forged');
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.zones.v1'))).toBe(legacy);
});
