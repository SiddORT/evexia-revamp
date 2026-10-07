import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { checkExportMenuStyles } from './helpers/export-menu-styles.mjs';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/product-categories';
const key = 'evexia.admin.product-categories.v1';
const legacy = '[{"id":"legacy-category","name":"Unused local category","unitPrice":125.5,"status":"active"}]';
const importPath = '/admin/masters/import/product-category';
const categoryFile = (name, rows) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`Product Category Name,Description,Unit Price,Status\n${rows}`) });
function workbookRows(bytes) {
  return JSON.parse(execFileSync('python3', ['-c', 'import io,json,sys,openpyxl;print(json.dumps(list(openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()),read_only=True).active.values)))'], { input: bytes, encoding: 'utf8' }));
}

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
  test.setTimeout(90000);
  await open(page);
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import Product Category data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Product Category Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Product category sample format')).toHaveCount(0);
  let excel;
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: format === 'csv' ? 'Download CSV sample' : 'Download Excel sample' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-product-category-template.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'xlsx') { expect(workbookRows(bytes)[0]).toEqual(['Product Category Name', 'Description', 'Unit Price', 'Status']); excel = bytes; }
    else expect(bytes.toString()).toContain('Product Category Name,Description,Unit Price,Status');
  }
  await page.getByTestId('input-category-import').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByTestId('category-excel-report').locator('.excel-import__valid')).toHaveText('1 valid');
  await page.getByRole('button', { name: 'Confirm import of 1 categories' }).click();
  await expect(page.getByRole('status')).toContainText('1 categories imported');
  const bytes = Buffer.from('Product Category Name,Description,Unit Price,Status\nTransfer North,,0,active\nTransfer South,Exact,125.500001,inactive\nTransfer Extra,,1,active');
  await page.getByTestId('input-category-import').setInputFiles({ name: 'categories.csv', mimeType: 'text/csv', buffer: bytes });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'categories.csv' })).toBeVisible();
  // Review has no writes; a real independent API read verifies this.
  expect(await page.evaluate(async () => (await (await import('/src/services/serverProductCategories.js')).listProductCategories({ query: 'Transfer' })).filtered)).toBe(0);
  await page.getByRole('button', { name: 'Confirm import of 3 categories' }).click();
  await expect(page.getByRole('status')).toContainText('3 categories imported');
  await page.getByRole('button', { name: 'Back to Product Category Master' }).click();
  await expect(page.getByTestId('text-category-count')).toBeVisible();
  await page.getByPlaceholder('Search category, description or price').fill('Transfer');
  await expect(page.getByTestId('text-category-count')).toContainText('of 3');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-product-category-master.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'csv') {
      expect(bytes.toString()).toContain('Created By,Created At,Updated By,Updated At');
      expect(bytes.toString()).toContain('Transfer North,,0.000000,active,Super Admin');
      expect(bytes.toString()).toContain('Transfer South,Exact,125.500001,inactive,Super Admin');
      expect(bytes.toString()).toContain('Transfer Extra,,1.000000,active,Super Admin');
    } else {
      const rows = workbookRows(bytes);
      expect(rows).toHaveLength(4);
      expect(rows.slice(1).map((row) => row.slice(0, 4))).toEqual(expect.arrayContaining([
        ['Transfer North', null, '0.000000', 'active'],
        ['Transfer South', 'Exact', '125.500001', 'inactive'],
        ['Transfer Extra', null, '1.000000', 'active'],
      ]));
    }
  }
  for (const { price, status, name } of [
    { price: '0', status: 'active', name: 'Transfer North' },
    { price: '125.500001', status: 'inactive', name: 'Transfer South' },
  ]) {
    // Clear the previous bounds first, avoiding an invalid transient range.
    await page.getByLabel('Minimum price').fill('');
    await page.getByLabel('Maximum price').fill('');
    await page.getByLabel('Minimum price').fill(price);
    await page.getByLabel('Maximum price').fill(price);
    await page.getByLabel('Status', { exact: true }).selectOption(status);
    await expect(page.getByTestId('text-category-count')).toContainText('of 1');
    for (const format of ['csv', 'xlsx']) {
      const download = page.waitForEvent('download');
      await page.getByTestId('button-export-categories').click();
      await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
      const bytes = await readFile(await (await download).path());
      if (format === 'csv') {
        expect(bytes.toString()).toContain(name);
        expect(bytes.toString()).not.toContain('Transfer Extra');
        expect(bytes.toString()).not.toContain(name === 'Transfer North' ? 'Transfer South' : 'Transfer North');
      } else {
        const rows = workbookRows(bytes);
        expect(rows).toHaveLength(2);
        expect(rows[1][0]).toBe(name);
        expect(rows[1][2]).toBe(price === '0' ? '0.000000' : price);
        expect(rows[1][3]).toBe(status);
      }
    }
  }
  await page.goto(`${base()}/admin/download-logs`);
  await expect(page.getByRole('heading', { name: 'Download Logs', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Product Category Master');
  await page.goto(`${base()}/admin/masters/import/product-category`);
  await page.getByTestId('input-category-import').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Category Name,Description,Unit Price,Status\nInvalid,,0.0000001,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 categories' })).toBeDisabled();
  await expect(page.getByTestId('category-excel-report')).toContainText('6 fractional digits');
  await page.screenshot({ path: info.outputPath('category-import-review.png'), fullPage: true });
});

test('Category uncertain import requires authoritative reconciliation and new review', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import Product Category data', exact: true })).toBeVisible();
  await page.getByTestId('input-category-import').setInputFiles({ name: 'uncertain.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Category Name,Description,Unit Price,Status\nUncertain Import,,0,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 categories' })).toBeEnabled();
  // Commit really succeeds, then replace its acknowledgment with unreadable
  // bytes. Wait for the completed handler/error before removing interception.
  await page.route('**/api/v1/admin/product-categories/import/commit?*', async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{ unreadable' });
  });
  await page.getByRole('button', { name: 'Confirm import of 1 categories' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'response could not be read' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.unroute('**/api/v1/admin/product-categories/import/commit?*');
  await page.getByTestId('input-category-import').setInputFiles(categoryFile('uncertain-replacement.csv', 'Uncertain Import,,0,active'));
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.route('**/api/v1/admin/product-categories?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Synthetic authoritative read unavailable.' } }) }));
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.unroute('**/api/v1/admin/product-categories?*');
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 categories' })).toBeDisabled();
  await expect(page.getByTestId('category-excel-report')).toContainText('already uses this name');
  await page.screenshot({ path: info.outputPath('category-import-reconciliation.png'), fullPage: true });
});

test('Category direct import, replacement, renewal and failed confirmation consume review', async ({ page }, info) => {
  test.setTimeout(90000);
  await open(page);
  await page.goto(`${base()}${importPath}`);
  const picker = page.getByTestId('input-category-import');
  const report = page.getByTestId('category-excel-report');
  await expect(page.getByRole('button', { name: 'Product Category Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.excel-import__number')).toHaveText(['01', '02']);
  await picker.setInputFiles(categoryFile('mixed.csv', 'Review Good,,0,active\nReview Bad,,0.0000001,unknown'));
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report.locator('.excel-import__valid')).toHaveText('1 valid');
  await expect(report.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await expect(report.locator('.excel-import__row--invalid')).toContainText('6 fractional digits');
  await expect(page.getByRole('button', { name: /Confirm import/ })).toBeDisabled();
  let arrived, release, complete;
  const started = new Promise((resolve) => { arrived = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const finished = new Promise((resolve) => { complete = resolve; });
  let reviews = 0;
  await page.route('**/api/v1/admin/product-categories/import/review?*', async (route) => {
    reviews++;
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
    complete();
  });
  await picker.setInputFiles(categoryFile('old.csv', 'Obsolete Review,,0,active'));
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await started;
  await page.getByRole('button', { name: 'Reviewing…', exact: true }).dispatchEvent('click');
  expect(reviews).toBe(1);
  await picker.setInputFiles(categoryFile('replacement.csv', 'Replacement Category,,999999999999.999999,active'));
  release();
  await finished;
  await page.unroute('**/api/v1/admin/product-categories/import/review?*');
  await expect(report).toHaveCount(0);
  await expect(page.locator('.excel-import__picker')).toContainText('replacement.csv');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  expect(await picker.evaluate((node) => node.files[0].name)).toBe('replacement.csv');
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report).toContainText('replacement.csv');
  await report.locator('summary').click();
  await expect(report).toContainText('999999999999.999999');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(report).toBeVisible();
  await page.route('**/api/v1/admin/product-categories/import/commit?*', (route) => route.fulfill({
    status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'product_category_duplicate', message: 'Synthetic conflict; review again.' } }),
  }));
  await page.getByRole('button', { name: /Confirm import/ }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic conflict');
  await expect(report).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.unroute('**/api/v1/admin/product-categories/import/commit?*');
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 900) {
      // Let the existing responsive drawer finish sliding offscreen before
      // capturing the import screen; theme changes do not own this animation.
      await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
      await expect.poll(async () => {
        const bounds = await page.locator('#admin-navigation').boundingBox();
        return bounds.x + bounds.width;
      }).toBeLessThanOrEqual(0);
    }
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(async (appearance) => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('appearance', appearance), appearance);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`category-import-${width}-${appearance}.png`), fullPage: true });
    }
  }
  let commitRelease, commitArrived, commits = 0;
  const commitStarted = new Promise((resolve) => { commitArrived = resolve; });
  const commitHeld = new Promise((resolve) => { commitRelease = resolve; });
  await page.route('**/api/v1/admin/product-categories/import/commit?*', async (route) => {
    commits++;
    const response = await route.fetch();
    commitArrived();
    await commitHeld;
    await route.fulfill({ response });
  });
  const confirm = page.getByRole('button', { name: /Confirm import/ });
  await confirm.click();
  await commitStarted;
  await expect(confirm).toHaveCount(0);
  await expect(picker).toBeDisabled();
  await page.getByRole('button', { name: 'Importing…', exact: true }).dispatchEvent('click');
  expect(commits).toBe(1);
  commitRelease();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('status')).toContainText('1 categories imported');
  await page.getByRole('button', { name: 'Zone Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Zone data', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Headquarter Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Headquarter data', exact: true })).toBeVisible();
});

test('Category export menu themes, keyboard, pending focus, rejection and late identity guard', async ({ page }, info) => {
  test.setTimeout(90000);
  await open(page);
  const trigger = page.getByTestId('button-export-categories');
  let requests = 0, downloads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/admin/product-categories/export') requests++; });
  page.on('download', () => downloads++);
  await expect(page.getByRole('combobox', { name: 'Product category export format' })).toHaveCount(0);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await checkExportMenuStyles(page, 'button-export-categories', 150);
    await trigger.click();
    const bounds = await page.getByRole('menu').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    await page.screenshot({ path: info.outputPath(`category-export-menu-${width}.png`) });
    await page.locator('h1').click({ force: true });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(requests).toBe(0);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/product-categories/export?*', async (route) => {
    await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'download_log_unavailable', message: 'Synthetic ledger acceptance unavailable.' } }) });
  });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeDisabled();
  expect(await trigger.evaluate((node) => node.disabled)).toBe(false);
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await trigger.dispatchEvent('click');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Export failed (Excel)');
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  expect(downloads).toBe(0);
  await page.unroute('**/api/v1/admin/product-categories/export?*');
  await page.route('**/api/v1/admin/product-categories/export?*', (route) => route.fulfill({ status: 200, contentType: 'text/csv', body: 'not accepted' }));
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Export failed (CSV)');
  expect(downloads).toBe(0);
  await page.unroute('**/api/v1/admin/product-categories/export?*');
  let arrived, finish;
  const started = new Promise((resolve) => { arrived = resolve; });
  const delayed = new Promise((resolve) => { finish = resolve; });
  await page.route('**/api/v1/admin/product-categories/export?*', async (route) => {
    const response = await route.fetch();
    arrived();
    await delayed;
    await route.fulfill({ response });
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await started;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  finish();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(0);
});

test('Category samples fail closed, replacement discards delayed download and duplicate sample is blocked', async ({ page }) => {
  await open(page);
  await page.goto(`${base()}${importPath}`);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/v1/admin/product-categories/sample?*', (route) => route.fulfill({ status: 200, body: 'missing acceptance' }));
  for (const name of ['Download CSV sample', 'Download Excel sample']) {
    await page.getByRole('button', { name }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(downloads).toBe(0);
  }
  await page.unroute('**/api/v1/admin/product-categories/sample?*');
  let arrived, release, requests = 0;
  const started = new Promise((resolve) => { arrived = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/product-categories/sample?*', async (route) => {
    requests++;
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
  });
  const button = page.getByRole('button', { name: 'Download CSV sample' });
  await button.click();
  await started;
  await button.dispatchEvent('click');
  expect(requests).toBe(1);
  await page.getByTestId('input-category-import').setInputFiles(categoryFile('sample-replacement.csv', 'Replaced During Sample,,0,active'));
  release();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(0);
});

test('Category review cannot return after logout', async ({ page }) => {
  await open(page);
  await page.goto(`${base()}${importPath}`);
  let arrived, release;
  const started = new Promise((resolve) => { arrived = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/product-categories/import/review?*', async (route) => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
  });
  await page.getByTestId('input-category-import').setInputFiles(categoryFile('logout.csv', 'Discard Draft,,0,active'));
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await started;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('category-excel-report')).toHaveCount(0);
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
