import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/product-categories';
const key = 'evexia.admin.product-categories.v1';
const legacy = '[{"id":"legacy-category","name":"Unused local category","unitPrice":125.5,"status":"active"}]';

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(`${base()}${path}`);
  await expect(page.getByTestId('text-category-count')).toBeVisible();
}
async function create(page, name, price = '999999999999.999999') {
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByTestId('input-category-name')).toHaveValue('');
  await page.getByTestId('input-category-name').fill(name);
  await page.getByTestId('input-category-description').fill('Synthetic description');
  await page.getByTestId('input-category-price').fill(price);
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/product-categories' && response.request().method() === 'POST');
  await page.getByTestId('button-save-category').click();
  const saved = await (await response).json();
  await expect(page.getByTestId('text-category-count')).toBeVisible();
  expect(saved.unit_price).toBe(price);
  return saved;
}

for (const mobile of [false, true]) {
  test(`Category ${mobile ? 'mobile' : 'desktop'} exact prices, drafts, concurrency, audit and retained deletion`, async ({ page }, info) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Unused local category', { exact: true })).toHaveCount(0);
    await expect(page.locator('main')).toContainText('Live changes do not affect demo inventory');
    const name = `Synthetic ${mobile ? 'Mobile' : 'Desktop'} Category`;
    const row = await create(page, name);
    const record = page.locator(mobile ? 'article[role=listitem]' : 'tbody tr').filter({ hasText: name });
    await expect(record).toContainText('999999999999.999999');
    await expect(record).toContainText('Super Admin');
    const timestamp = await page.evaluate(async (at) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('dateFormat', 'yyyy-mm-dd');
      prefs.setAdminPreference('timeZone', 'UTC');
      prefs.setAdminPreference('clock', '24');
      return prefs.formatAdminTimestamp(at);
    }, row.createdAt);
    await expect(record).toContainText(timestamp);
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    await expect(page.getByTestId('input-category-price')).toHaveValue('999999999999.999999');
    await page.getByTestId('input-category-name').fill(name + ' Edited');
    await page.getByTestId('input-category-price').fill('125.500001');
    await page.evaluate(async (row) => {
      await (await import('/src/services/serverProductCategories.js')).editProductCategory(row, {
        name: row.name + ' Concurrent', description: 'Changed elsewhere', unit_price: '0', status: 'active',
      });
    }, row);
    await page.getByTestId('button-save-category').click();
    await expect(page.getByRole('alert')).toContainText('Product category changed');
    await expect(page.getByTestId('button-save-category')).toBeDisabled();
    await page.getByRole('button', { name: 'Review current server details (keep draft)' }).click();
    await expect(page.getByRole('alert')).toContainText('Changed elsewhere');
    await expect(page.getByTestId('input-category-name')).toHaveValue(name + ' Edited');
    await expect(page.getByTestId('input-category-price')).toHaveValue('125.500001');
    await page.getByTestId('button-save-category').click();
    await expect(page.getByTestId('text-category-count')).toBeVisible();
    await expect(record).toContainText('125.500001');
    await page.reload();
    await expect(page.getByTestId('text-category-count')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('text-category-count')).toBeVisible();
    await expect(record).toContainText(name + ' Edited');
    await page.getByLabel('Minimum price', { exact: true }).fill('125.500001');
    await page.getByLabel('Maximum price', { exact: true }).fill('125.500001');
    await page.getByPlaceholder('Search category, description or price').fill(name);
    await expect(page.getByTestId('text-category-count')).toContainText('of 1');
    await page.getByLabel('Minimum price', { exact: true }).fill('126');
    await expect(page.getByRole('alert')).toContainText('Minimum price must not exceed maximum price');
    await page.getByLabel('Minimum price', { exact: true }).fill('125.500001');
    await expect(record).toContainText('125.500001');
    await page.getByRole('button', { name: `Inactivate ${name} Edited`, exact: true }).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption('inactive');
    await expect(page.getByTestId('text-category-count')).toContainText('of 1');
    await page.screenshot({ path: info.outputPath(`category-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    await page.getByRole('button', { name: `Activate ${name} Edited`, exact: true }).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(record).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption('all');
    await expect(record).toContainText(name + ' Edited');
    await page.getByRole('button', { name: `Delete ${name} Edited`, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Server deletion history is retained');
    await page.getByTestId('button-cancel-confirmation').click();
    await expect(record).toContainText(name + ' Edited');
    await page.getByRole('button', { name: `Delete ${name} Edited`, exact: true }).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(record).toHaveCount(0);
  });
}

test('Category CSV/XLSX review, explicit atomic confirmation, filtered exports and ledger', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import Product Category Master', exact: true })).toBeVisible();
  let excel;
  for (const format of ['csv', 'xlsx']) {
    await page.getByLabel('Product category sample format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-product-category-template.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'xlsx') { expect(bytes.subarray(0, 2).toString()).toBe('PK'); excel = bytes; }
    else expect(bytes.toString()).toContain('Product Category Name,Description,Unit Price,Status');
  }
  await page.getByTestId('input-category-import').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'Review rows' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm import 1 categories' }).click();
  await expect(page.getByRole('status')).toContainText('1 categories imported');
  const bytes = Buffer.from('Product Category Name,Description,Unit Price,Status\nTransfer North,,0,active\nTransfer South,Exact,125.500001,inactive\nTransfer Extra,,1,active');
  await page.getByTestId('input-category-import').setInputFiles({ name: 'categories.csv', mimeType: 'text/csv', buffer: bytes });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'Review rows' })).toBeVisible();
  // Review has no writes; a real independent API read verifies this.
  expect(await page.evaluate(async () => (await (await import('/src/services/serverProductCategories.js')).listProductCategories({ query: 'Transfer' })).filtered)).toBe(0);
  await page.getByRole('button', { name: 'Confirm import 3 categories' }).click();
  await expect(page.getByRole('status')).toContainText('3 categories imported');
  await page.getByRole('button', { name: 'Back to categories' }).click();
  await expect(page.getByTestId('text-category-count')).toBeVisible();
  await page.getByPlaceholder('Search category, description or price').fill('Transfer');
  await expect(page.getByTestId('text-category-count')).toContainText('of 3');
  await page.getByLabel('Rows per page').selectOption('2');
  for (const format of ['csv', 'xlsx']) {
    await page.getByLabel('Product category export format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-product-category-master.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'csv') {
      expect(bytes.toString()).toContain('Created By,Created At,Updated By,Updated At');
      expect(bytes.toString()).toContain('Transfer North,,0.000000,active,Super Admin');
      expect(bytes.toString()).toContain('Transfer South,Exact,125.500001,inactive,Super Admin');
      expect(bytes.toString()).toContain('Transfer Extra,,1.000000,active,Super Admin');
    } else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  await page.getByLabel('Minimum price').fill('0');
  await page.getByLabel('Maximum price').fill('0');
  await expect(page.getByTestId('text-category-count')).toContainText('of 1');
  await page.goto(`${base()}/admin/download-logs`);
  await expect(page.getByRole('heading', { name: 'Download Logs', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Product Category Master');
  await page.goto(`${base()}/admin/masters/import/product-category`);
  await page.getByTestId('input-category-import').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Category Name,Description,Unit Price,Status\nInvalid,,0.0000001,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import 1 categories' })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Product category import rows' })).toContainText('6 fractional digits');
  await page.screenshot({ path: info.outputPath('category-import-review.png'), fullPage: true });
});

test('Category uncertain import requires authoritative reconciliation and new review', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import Product Category Master', exact: true })).toBeVisible();
  await page.getByTestId('input-category-import').setInputFiles({ name: 'uncertain.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Category Name,Description,Unit Price,Status\nUncertain Import,,0,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import 1 categories' })).toBeEnabled();
  // Commit really succeeds, then replace its acknowledgment with unreadable
  // bytes. Wait for the completed handler/error before removing interception.
  await page.route('**/api/v1/admin/product-categories/import/commit?*', async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{ unreadable' });
  });
  await page.getByRole('button', { name: 'Confirm import 1 categories' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'response could not be read' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.unroute('**/api/v1/admin/product-categories/import/commit?*');
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import 1 categories' })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Product category import rows' })).toContainText('already uses this name');
  await page.screenshot({ path: info.outputPath('category-import-reconciliation.png'), fullPage: true });
});

test('Category renewal retains drafts; committed lost create response blocks duplicate resubmission', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByTestId('input-category-name').fill('Unsaved Synthetic Category Draft');
  await page.getByTestId('input-category-price').fill('0');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-category-name')).toHaveValue('Unsaved Synthetic Category Draft');
  await expect(page.getByTestId('input-category-price')).toHaveValue('0');
  await page.getByTestId('input-category-price').fill('0.0000001');
  await page.getByTestId('button-save-category').click();
  await expect(page.getByRole('alert')).toContainText('6 fractional digits');
  await page.getByTestId('input-category-price').fill('0');
  await page.route('**/api/v1/admin/product-categories?*', async (route) => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByTestId('button-save-category').click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByTestId('button-save-category')).toBeDisabled();
  await page.unroute('**/api/v1/admin/product-categories?*');
  await page.getByRole('button', { name: 'Review current server details (keep draft)' }).click();
  await expect(page.getByRole('alert')).toContainText('already saved');
  await expect(page.getByTestId('button-save-category')).toBeDisabled();
  await expect(page.getByTestId('input-category-name')).toHaveValue('Unsaved Synthetic Category Draft');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(page.getByTestId('input-category-name')).toHaveCount(0);
});
