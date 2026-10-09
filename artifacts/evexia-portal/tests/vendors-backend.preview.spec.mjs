import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const key = 'evexia.admin.vendors.v1';
const legacy = '[{"id":"local-only","vendorName":"Untouched local procurement vendor"}]';
const headers = 'Vendor Name,GST No.,Registered Address,Contact Person Name,Email ID,Phone No.,Dial Country,Status';
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const gst = (number) => `27DDDDD${String(number).padStart(4, '0')}D1Z8`;

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(`${base()}/admin/masters/vendors`);
  await expect(page.getByTestId('text-vendor-count')).toBeVisible();
}

async function create(page, name, gstNo) {
  await page.getByTestId('button-add-vendor').click();
  await expect(page.getByTestId('select-vendor-dialCountry')).toHaveValue('IN');
  await expect(page.getByTestId('select-vendor-status')).toHaveValue('active');
  for (const [field, value] of Object.entries({ vendorName: name, gstNo, registeredAddress: 'Synthetic address\nSecond floor',
    contactPersonName: 'Synthetic Contact', emailId: 'contact@example.test', phoneNo: '501234567' })) {
    await page.getByTestId(`input-vendor-${field}`).fill(value);
  }
  await page.getByTestId('select-vendor-dialCountry').selectOption('AE');
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/vendors' && r.request().method() === 'POST');
  await page.getByTestId('button-save-vendor').click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const record = await response.json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`link-vendor-${page.viewportSize().width < 1050 ? 'mobile-' : ''}phone-${record.id}`)).toHaveText('+971 501234567');
  return record;
}

for (const mobile of [false, true]) {
  test(`vendor ${mobile ? 'mobile dark' : 'desktop light'} shared modal, conflicts, status and deletion`, async ({ page, context }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    await open(page);
    if (mobile) await page.evaluate(async () => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('theme', 'dark');
    });
    await expect(page.getByText('Untouched local procurement vendor', { exact: true })).toHaveCount(0);
    const record = await create(page, `Vendor ${tag()}`, gst(mobile ? 2 : 1));
    const row = () => page.getByTestId(`${mobile ? 'card' : 'row'}-vendor-${record.id}`);
    await expect(row()).toContainText('Super Admin');
    const other = await context.newPage();
    await other.goto(`${base()}/admin/masters/vendors`);
    await expect(other.getByTestId('text-vendor-count')).toBeVisible();
    await expect(other.locator(`[data-testid="row-vendor-${record.id}"], [data-testid="card-vendor-${record.id}"]`).filter({ visible: true })).toContainText(record.vendorName);
    await other.close();
    await page.reload();
    await expect(row()).toBeVisible();
    await page.getByTestId(`button-edit-vendor-${mobile ? 'mobile-' : ''}${record.id}`).click();
    await expect(page.getByTestId('select-vendor-dialCountry')).toHaveValue('AE');
    await expect(page.getByTestId('input-vendor-phoneNo')).toHaveValue('501234567');
    await page.getByTestId('input-vendor-vendorName').fill(record.vendorName + ' draft');
    await page.evaluate(async (record) => {
      const { editVendor } = await import('/src/services/serverVendors.js');
      const { vendorName, gstNo, registeredAddress, contactPersonName, emailId, phoneNo, dialCountry, status } = record;
      await editVendor(record, { vendorName: vendorName + ' concurrent', gstNo, registeredAddress, contactPersonName, emailId, phoneNo, dialCountry, status });
    }, record);
    await page.getByTestId('button-save-vendor').click();
    await expect(page.getByTestId('status-vendor-save-error')).toContainText('changed');
    await expect(page.getByTestId('input-vendor-vendorName')).toHaveValue(record.vendorName + ' draft');
    await expect(page.getByTestId('button-save-vendor')).toBeDisabled();
    await page.getByTestId('button-reload-vendor').click();
    await expect(page.getByTestId('button-discard-vendor-draft')).toBeVisible();
    await expect(page.getByTestId('button-save-vendor')).toBeDisabled();
    await page.getByTestId('button-discard-vendor-draft').click();
    await expect(page.getByTestId('input-vendor-vendorName')).toHaveValue(record.vendorName + ' concurrent');
    await page.getByTestId('select-vendor-dialCountry').selectOption('US');
    await page.getByTestId('input-vendor-phoneNo').fill('(202) 555-0123');
    await page.getByTestId('button-save-vendor').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row()).toContainText('+1 2025550123');
    await page.getByTestId(`button-toggle-vendor-${mobile ? 'mobile-' : ''}${record.id}`).click();
    await page.getByRole('button', { name: 'Inactivate vendor', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('input-search-vendors').fill(record.vendorName);
    await page.getByTestId('select-filter-vendors').selectOption('inactive');
    await expect(row()).toBeVisible();
    await expect(page.getByTestId('text-vendor-count')).toContainText('of 1');
    await page.getByTestId('select-filter-vendors').selectOption('active');
    await expect(page.getByTestId('status-vendors-empty')).toBeVisible();
    await page.getByTestId('button-clear-vendor-filters').click();
    await expect(row()).toBeVisible();
    await expect(page.getByText('Loading shared vendors…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`vendor-populated-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
    await page.getByTestId(`button-delete-vendor-${mobile ? 'mobile-' : ''}${record.id}`).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row()).toBeVisible();
    await page.getByTestId(`button-delete-vendor-${mobile ? 'mobile-' : ''}${record.id}`).click();
    await page.getByRole('button', { name: 'Delete vendor', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row()).toHaveCount(0);
    await expect(page.getByText('Loading shared vendors…', { exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.screenshot({ path: test.info().outputPath(`vendor-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
  });
}

test('vendor authenticated CSV/XLSX review, filtered full export menu, evidence and file ownership', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  await page.getByTestId('button-import-vendors').click();
  await expect(page.getByRole('button', { name: 'Vendor Master', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const format of ['CSV', 'Excel']) {
    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${format} sample`, exact: true }).click();
    const download = await wait;
    const bytes = await readFile(await download.path());
    expect(download.suggestedFilename()).toBe(`evexia-vendor-template.${format === 'CSV' ? 'csv' : 'xlsx'}`);
    if (format === 'CSV') expect(bytes.toString('utf8')).toContain(headers);
    else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  const name = `Import ${tag()}`;
  const data = `${headers}\n${name} one,${gst(100)},Address,Contact,a@example.test,9876543210,IN,active\n${name} two,${gst(101)},Address,Contact,b@example.test,501234567,AE,inactive\n${name} three,${gst(102)},Address,Contact,c@example.test,2025550123,US,inactive`;
  await page.getByTestId('input-vendor-import').setInputFiles({ name: 'vendors.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('vendor-excel-report')).toContainText('3 valid');
  expect(await page.evaluate(async (query) => (await (await import('/src/services/serverVendors.js')).listVendors({ query })).filtered, name)).toBe(0);
  await page.getByTestId('button-confirm-vendor-import').click();
  await expect(page.getByRole('status')).toContainText('3 vendors imported');
  await page.getByRole('button', { name: 'Back to Vendor Master' }).click();
  await expect(page.getByTestId('text-vendor-count')).toBeVisible();
  await page.getByTestId('input-search-vendors').fill(name);
  await page.getByLabel('Rows per page', { exact: true }).selectOption('2');
  await expect(page.getByTestId('text-vendor-count')).toContainText('of 3');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-vendor-count')).toContainText('3–3');
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await page.getByTestId('button-export-vendors').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'CSV' })).toBeVisible();
  expect(downloads).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('button-export-vendors')).toBeFocused();
  const files = [];
  for (const [label, format] of [['CSV', 'csv'], ['Excel (.xlsx)', 'xlsx']]) {
    await page.getByTestId('button-export-vendors').click();
    const wait = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    const download = await wait;
    files.push({ name: `export.${format}`, mimeType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await download.path()) });
    if (format === 'csv') {
      expect(files.at(-1).buffer.toString('utf8').match(/Import /g)).toHaveLength(3);
      expect(files.at(-1).buffer.toString('utf8')).toContain('Dial Country,Status,Created By,Created At,Updated By,Updated At');
    } else expect(files.at(-1).buffer.subarray(0, 2).toString()).toBe('PK');
  }
  await page.getByTestId('select-filter-vendors').selectOption('inactive');
  await expect(page.getByTestId('text-vendor-count')).toContainText('of 2');
  await page.getByTestId('button-import-vendors').click();
  for (const file of files) {
    await page.getByTestId('input-vendor-import').setInputFiles(file);
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await expect(page.getByTestId('vendor-excel-report')).toContainText('3 invalid');
    await expect(page.getByTestId('button-confirm-vendor-import')).toBeDisabled();
  }
  // Late review for a replaced file is never displayed.
  let release, reached, finished;
  const arrived = new Promise((resolve) => { reached = resolve; });
  const handled = new Promise((resolve) => { finished = resolve; });
  await page.route('**/api/v1/admin/vendors/import/review?*', async (route) => {
    reached();
    await new Promise((resolve) => { release = resolve; });
    try {
      await route.fulfill({ json: { valid: true, validCount: 1, invalidCount: 0, digest: 'a'.repeat(64), rows: [{ row: 2, values: { vendorName: 'LATE OLD FILE' }, errors: [] }] } });
    } finally { finished(); }
  });
  await page.getByTestId('input-vendor-import').setInputFiles({ name: 'held.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await arrived;
  await page.getByTestId('input-vendor-import').setInputFiles({ name: 'new.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  release();
  await handled;
  await expect(page.getByText('LATE OLD FILE')).toHaveCount(0);
  await page.unroute('**/api/v1/admin/vendors/import/review?*');
  const after = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  expect(after - before).toBe(4);
  // An otherwise successful sample with no durable ledger header cannot hand off.
  await page.route('**/api/v1/admin/vendors/sample?format=csv', (route) => route.fulfill({
    contentType: 'text/csv', body: headers, status: 200,
  }));
  await page.getByRole('button', { name: 'Download CSV sample', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('logging could not be confirmed');
  expect(downloads).toBe(2);
  await page.unroute('**/api/v1/admin/vendors/sample?format=csv');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
  await page.screenshot({ path: test.info().outputPath('vendor-import.png'), fullPage: true });
});

test('vendor drafts survive same-route renewal and failed saves; denied session clears protected drafts', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-vendor').click();
  await page.getByTestId('input-vendor-vendorName').fill('Preserved vendor draft');
  let count = 0;
  await page.route('**/api/v1/auth/me', (route) => {
    count++;
    return count === 1 ? route.fulfill({ status: 503, json: { error: { message: 'synthetic outage' } } }) : route.continue();
  });
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession());
  await expect(page.getByRole('button', { name: 'Retry session verification' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(page.getByTestId('input-vendor-vendorName')).toHaveValue('Preserved vendor draft');
  await page.unroute('**/api/v1/auth/me');
  await page.getByTestId('button-cancel-vendor').click();
  await page.getByTestId('button-import-vendors').click();
  await page.getByTestId('input-vendor-import').setInputFiles({ name: 'draft.csv', mimeType: 'text/csv', buffer: Buffer.from(headers) });
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-vendor-import')).toBeVisible();
  await expect(page.getByText('draft.csv', { exact: true })).toBeVisible();
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('input-vendor-import')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
});
