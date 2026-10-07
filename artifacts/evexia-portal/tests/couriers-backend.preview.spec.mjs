import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const key = 'evexia.admin.courier-partners.v1';
const legacy = '[{"id":"legacy-courier","name":"Untouched local courier","status":"active"}]';
async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(`${base()}/admin/masters/courier-partners`);
  await expect(page.getByTestId('text-courier-partner-count')).toBeVisible();
}
async function create(page, name) {
  await page.getByTestId('button-add-courier-partner').click();
  await page.getByLabel('Courier partner name *').fill(name);
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/courier-partners' && response.request().method() === 'POST');
  await page.getByTestId('button-save-courier-partner').click();
  const row = await (await response).json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toHaveText(name);
  return row;
}

for (const mobile of [false, true]) {
  test(`courier ${mobile ? 'mobile' : 'desktop'} CRUD, attribution, persistence and local isolation`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Untouched local courier', { exact: true })).toHaveCount(0);
    const name = mobile ? 'Mobile synthetic courier' : 'Desktop synthetic courier';
    const row = await create(page, name);
    const record = page.locator(mobile ? `[data-testid="card-courier-partner-${row.id}"]` : 'tr')
      .filter({ has: page.getByTestId(`text-courier-partner-name-${row.id}`) });
    await expect(record).toContainText('Super Admin');
    await expect(record).not.toContainText('Admin User');
    const timestamp = await page.evaluate(async (at) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('dateFormat', 'yyyy-mm-dd');
      prefs.setAdminPreference('timeZone', 'UTC');
      prefs.setAdminPreference('clock', '24');
      return prefs.formatAdminTimestamp(at);
    }, row.createdAt);
    await expect(record).toContainText(timestamp);
    await page.getByTestId(`button-edit-courier-partner-${row.id}`).click();
    await page.getByLabel('Courier partner name *').fill(name + ' edited');
    await page.route(`**/api/v1/admin/courier-partners/${row.id}/edit?*`, (route) => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'courier_unavailable', message: 'Persistence temporarily unavailable.' } }),
    }));
    await page.getByTestId('button-save-courier-partner').click();
    await expect(page.getByRole('dialog')).toContainText('temporarily unavailable');
    await expect(page.getByLabel('Courier partner name *')).toHaveValue(name + ' edited');
    await page.unroute(`**/api/v1/admin/courier-partners/${row.id}/edit?*`);
    // A concurrent server edit must not overwrite this mounted draft.
    await page.evaluate(async (row) => {
      await (await import('/src/services/serverCouriers.js')).editCourier(row, { name: row.name + ' concurrent', status: 'active' });
    }, row);
    await page.getByTestId('button-save-courier-partner').click();
    await expect(page.getByRole('dialog')).toContainText('Courier partner changed');
    await expect(page.getByTestId('button-save-courier-partner')).toBeDisabled();
    await expect(page.getByLabel('Courier partner name *')).toHaveValue(name + ' edited');
    await page.getByRole('button', { name: 'Review current server record' }).click();
    await expect(page.getByRole('dialog')).toContainText('concurrent');
    await page.getByTestId('button-save-courier-partner').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toHaveText(name + ' edited');
    await page.getByTestId(`button-toggle-courier-partner-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('select-filter-courier-partners').selectOption('inactive');
    await page.getByTestId('input-search-courier-partners').fill(name);
    await expect(page.getByTestId('text-courier-partner-count')).toContainText('of 1');
    await page.getByTestId(`button-toggle-courier-partner-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toHaveCount(0);
    await page.getByTestId('select-filter-courier-partners').selectOption('all');
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-delete-courier-partner-${row.id}`).click();
    await expect(page.getByRole('dialog')).toContainText('Server deletion history is retained');
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-courier-partner-name-${row.id}`)).toHaveCount(0);
    expect(await page.evaluate(async (id) => {
      try { await (await import('/src/services/serverCouriers.js')).getCourier(id); return false; }
      catch (error) { return error.status === 404; }
    }, row.id)).toBe(true);
  });
}

test('courier complete filtered CSV/XLSX export and explicit transactional import', async ({ page }) => {
  await open(page);
  for (const suffix of ['alpha', 'beta', 'gamma']) await create(page, 'Courier export synthetic ' + suffix);
  await page.evaluate(async () => {
    const { createCourier } = await import('/src/services/serverCouriers.js');
    await createCourier({ name: 'Courier export synthetic excluded inactive', status: 'inactive' });
    await createCourier({ name: 'Unrelated export synthetic', status: 'active' });
  });
  await page.getByTestId('input-search-courier-partners').fill('Courier export synthetic');
  await page.getByTestId('select-filter-courier-partners').selectOption('active');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.getByTestId('text-courier-partner-count')).toContainText('of 3');
  for (const format of ['csv', 'xlsx']) {
    await page.getByTestId('button-export-courier-partners').click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename()).toBe(`evexia-courier-partner-master.${format}`);
    const contents = await readFile(await result.path());
    if (format === 'csv') {
      for (const suffix of ['alpha', 'beta', 'gamma']) expect(contents.toString()).toContain('Courier export synthetic ' + suffix);
      expect(contents.toString()).not.toContain('excluded inactive');
      expect(contents.toString()).not.toContain('Unrelated export synthetic');
    }
    else {
      expect(contents.subarray(0, 2).toString()).toBe('PK');
      const rows = await page.evaluate(async (bytes) => {
        const { readExcelRows } = await import('/src/services/mockExcelImport.js');
        return (await readExcelRows(new File([new Uint8Array(bytes)], 'export.xlsx'))).map((row) => row.cells);
      }, [...contents]);
      for (const suffix of ['alpha', 'beta', 'gamma']) expect(rows.flat()).toContain('Courier export synthetic ' + suffix);
      expect(rows[0]).toEqual(['Courier Partner Name', 'Status', 'Created By', 'Created At', 'Updated By', 'Updated At']);
      expect(rows.flat()).not.toContain('crm-admin@allergyevexia.in');
      expect(rows.flat()).not.toContain('Courier export synthetic excluded inactive');
      expect(rows.flat()).not.toContain('Unrelated export synthetic');
    }
  }
  await page.getByTestId('button-import-courier-partners').click();
  await page.getByLabel('Courier CSV or Excel file').setInputFiles({
    name: 'duplicates.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Courier Partner Name,Status\nDuplicate courier,active\nduplicate   courier,inactive'),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 courier partners' })).toBeDisabled();
  await expect(page.locator('.excel-import__valid')).toHaveText('1 valid');
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await expect(page.locator('.excel-import__row--invalid')).toContainText('Row 3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel sample' }).click();
  const sample = await download;
  await page.getByLabel('Courier CSV or Excel file').setInputFiles({
    name: 'template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await readFile(await sample.path()),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 courier partners' })).toBeEnabled();
  expect(await page.evaluate(async () => (await (await import('/src/services/serverCouriers.js')).listCouriers({ query: 'Example', status: 'all', limit: 10, offset: 0 })).filtered)).toBe(0);
  await page.getByRole('button', { name: 'Confirm import of 2 courier partners' }).click();
  await expect(page.getByRole('status')).toContainText('2 courier partners imported');
  expect(await page.getByLabel('Courier CSV or Excel file').evaluate((node) => node.files.length)).toBe(0);
  await page.getByLabel('Courier CSV or Excel file').setInputFiles({
    name: 'backup.csv', mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFFCourier Partner Name,Status,Created By,Created At,Updated By,Updated At\nCSV courier synthetic,Inactive,Forged,1900,Forged,1900'),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm import of 1 courier partners' }).click();
  await expect(page.getByRole('status')).toContainText('1 courier partners imported');
  await page.getByRole('button', { name: 'Back to Courier Partner Master' }).click();
  await page.getByTestId('input-search-courier-partners').fill('CSV courier synthetic');
  await expect(page.getByTestId('text-courier-partner-count')).toContainText('of 1');
  await expect(page.locator('tr').filter({ hasText: 'CSV courier synthetic' })).toContainText('Super Admin');
  await expect(page.locator('tr').filter({ hasText: 'CSV courier synthetic' })).not.toContainText('Forged');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
});

test('courier draft survives same-route renewal and retry; logout removes it', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-courier-partner').click();
  const input = page.getByLabel('Courier partner name *');
  await input.fill('Synthetic courier renewal draft');
  await page.evaluate(() => { window.courierDraftNode = document.getElementById('courier-partner-name'); });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  await page.route('**/api/v1/auth/refresh', async (route) => { await gate; await route.continue(); });
  const renewal = page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('admin-session-content')).toBeHidden();
  await expect(input).toHaveValue('Synthetic courier renewal draft');
  resume();
  await renewal;
  await expect(input).toBeVisible();
  await page.unroute('**/api/v1/auth/refresh');
  await page.route('**/api/v1/auth/refresh', (route) => route.abort());
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  await expect(input).toHaveValue('Synthetic courier renewal draft');
  await page.unroute('**/api/v1/auth/refresh');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.courierDraftNode === document.getElementById('courier-partner-name'))).toBe(true);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(input).toHaveCount(0);
});
