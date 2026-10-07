import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const legacy = '[{"id":"legacy-zone","name":"Untouched local zone","status":"active"}]';
const zoneFile = (name) => ({ name: `${name}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Zone Name,Status\n${name},active`) });

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate((value) => localStorage.setItem('evexia.admin.zones.v1', value), legacy);
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByTestId('button-add-zone')).toBeVisible();
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
  test.setTimeout(90000);
  await open(page);
  await create(page, 'Export synthetic alpha');
  await create(page, 'Export synthetic beta');
  await create(page, 'Export synthetic gamma');
  const inactive = await create(page, 'Export synthetic excluded inactive');
  await page.getByTestId(`button-toggle-zone-${inactive.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('input-search-zones').fill('Export synthetic');
  await page.getByTestId('select-filter-zones').selectOption('active');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.getByTestId('text-zone-count')).toContainText('of 3');
  const downloadCSV = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  const csv = await downloadCSV;
  expect(csv.suggestedFilename()).toBe('evexia-zone-master.csv');
  const content = await readFile(await csv.path(), 'utf8');
  for (const name of ['alpha', 'beta', 'gamma']) expect(content).toContain(`Export synthetic ${name}`);
  expect(content).not.toContain('Untouched local zone');
  expect(content).not.toContain('excluded inactive');
  expect(content).toContain('Super Admin');
  const downloadXLSX = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  const xlsx = await downloadXLSX;
  expect(xlsx.suggestedFilename()).toBe('evexia-zone-master.xlsx');
  expect((await readFile(await xlsx.path())).subarray(0, 2).toString()).toBe('PK');
  await page.getByTestId('button-import-zones').click();
  await expect(page.getByRole('navigation', { name: 'Select a master for import' }).getByRole('button', { name: 'Zone Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.excel-import__card')).toHaveCount(2);
  // The downloaded Excel backup has all filtered matches, not just page one.
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'export-backup.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await xlsx.path()),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('3 invalid');
  for (const name of ['alpha', 'beta', 'gamma']) await expect(page.getByTestId('zone-excel-report')).toContainText(`Export synthetic ${name}`);
  await expect(page.getByTestId('zone-excel-report')).not.toContainText('excluded inactive');
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'duplicates.csv', mimeType: 'text/csv', buffer: Buffer.from('Zone Name,Status\nDuplicate synthetic,active\nduplicate synthetic,active'),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 zones' })).toBeDisabled();
  await expect(page.getByText('Duplicate name within this file.')).toBeVisible();
  await expect(page.locator('.excel-import__valid')).toHaveText('1 valid');
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  const sampleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel sample' }).click();
  const sample = await sampleDownload;
  // Playwright path has a generated filename; provide the genuine downloaded
  // workbook explicitly with the required .xlsx extension.
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await sample.path()),
  });
  await expect(page.getByTestId('zone-excel-report')).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm import of 2 zones' })).toBeEnabled();
  const countBefore = await page.evaluate(async () => (await (await import('/src/services/serverZones.js')).listZones({ query: 'Example', status: 'all', limit: 10, offset: 0 })).filtered);
  expect(countBefore).toBe(0);
  await page.getByRole('button', { name: 'Confirm import of 2 zones' }).click();
  await expect(page.getByRole('status')).toContainText('2 zones imported');
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({
    name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFFZone Name,Status,Created By,Created At,Updated By,Updated At\nCSV synthetic,Inactive,Forged,1900,Forged,1900'),
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm import of 1 zones' }).click();
  await expect(page.getByRole('status')).toContainText('1 zones imported');
  await page.getByRole('button', { name: 'Back to Zone Master' }).click();
  await page.getByTestId('input-search-zones').fill('CSV synthetic');
  await expect(page.getByTestId('text-zone-count')).toContainText('of 1');
  await expect(page.locator('tr').filter({ hasText: 'CSV synthetic' })).toContainText('Super Admin');
  await expect(page.locator('tr').filter({ hasText: 'CSV synthetic' })).not.toContainText('Forged');
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.zones.v1'))).toBe(legacy);
});

test('prepared Zone import keeps the file draft through renewal, rejects late reviews and consumes failed confirmations', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.getByTestId('button-import-zones').click();
  const picker = page.getByLabel('Zone CSV or Excel file');
  const upload = page.getByRole('button', { name: 'Upload & review', exact: true });
  await picker.setInputFiles(zoneFile('Synthetic stale review'));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/v1/admin/zones/import/review?*', async (route) => {
    attempts++;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await upload.click();
  await expect(page.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reviewing…' }).dispatchEvent('click');
  await expect.poll(() => attempts).toBe(1);
  await picker.setInputFiles(zoneFile('Synthetic replacement file'));
  await expect(page.getByTestId('zone-excel-report')).toHaveCount(0);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('zone-excel-report')).toHaveCount(0);
  await expect(page.locator('.excel-import__picker')).toContainText('Synthetic replacement file.csv');
  await upload.click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toBeEnabled();
  let first = true;
  await page.route('**/api/v1/admin/zones/import/review?*', (route) => {
    if (!first) return route.continue();
    first = false;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
  await upload.click();
  await expect(page.getByRole('alert')).toContainText('Session renewed. Your draft is preserved');
  await expect(page.locator('.excel-import__picker')).toContainText('Synthetic replacement file.csv');
  expect(await picker.evaluate((node) => node.files[0].name)).toBe('Synthetic replacement file.csv');
  await page.unroute('**/api/v1/admin/zones/import/review?*');
  await upload.click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toBeEnabled();
  // A real competing create makes the reviewed batch conflict.
  await page.evaluate(async () => (await import('/src/services/serverZones.js')).createZone({ name: 'Synthetic replacement file', status: 'active' }));
  await page.getByRole('button', { name: 'Confirm import of 1 zones' }).click();
  await expect(page.getByRole('alert')).toContainText('Review the file again');
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toHaveCount(0);
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  // Recoverable same-route verification failure must preserve the file node.
  await picker.evaluate((node) => { window.zoneDraftPicker = node; });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession());
  await expect(page.getByRole('button', { name: 'Retry session verification' })).toBeVisible();
  await expect(page.getByTestId('admin-session-content')).toBeHidden();
  await page.unroute('**/api/v1/auth/me');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(picker).toBeAttached();
  expect(await picker.evaluate((node) => node === window.zoneDraftPicker && node.files[0].name === 'Synthetic replacement file.csv')).toBe(true);
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toBeDisabled();

  await picker.setInputFiles(zoneFile('Synthetic uncertain import'));
  await upload.click();
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toBeEnabled();
  let commits = 0;
  await page.route('**/api/v1/admin/zones/import/commit?*', async (route) => {
    commits++;
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Confirm import of 1 zones' }).click();
  await expect(page.getByRole('alert')).toContainText('Save outcome could not be confirmed');
  expect(commits).toBe(1);
  await expect(page.getByRole('button', { name: 'Confirm import of 1 zones' })).toHaveCount(0);
  await page.unroute('**/api/v1/admin/zones/import/commit?*');
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
});

test('prepared Zone cards and master tabs retain preview semantics in desktop/mobile themes', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.goto(`${base()}/admin/masters/import/zone`);
  await expect(page.getByRole('heading', { name: 'Import Zone data', exact: true })).toBeVisible();
  for (const [theme, appearance, width] of [['classic', 'light', 1440], ['classic', 'dark', 390], ['modern', 'light', 390], ['modern', 'dark', 1440]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async ({ theme, appearance }) => {
      const preferences = await import('/src/components/admin/adminPreferences.js');
      preferences.setAdminPreference('theme', theme);
      preferences.setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const cards = page.locator('.excel-import__card');
    await expect(cards).toHaveCount(2);
    const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
    expect(width < 760 ? b.y > a.y + a.height : Math.abs(b.y - a.y) < 2).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`zone-import-${theme}-${appearance}-${width}.png`), fullPage: true });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV sample', exact: true }).click();
  const sample = await download;
  expect(sample.suggestedFilename()).toBe('evexia-zone-sample.csv');
  expect(await readFile(await sample.path(), 'utf8')).toContain('Zone Name,Status');
  const tabs = page.getByRole('navigation', { name: 'Select a master for import' });
  await tabs.getByRole('button', { name: 'MR Master', exact: true }).click();
  await expect(page.getByText('UI preview · Nothing will be saved')).toBeVisible();
  await expect(page.locator('.excel-import__card')).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Select a master for import' }).getByRole('button', { name: 'Doctor Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Doctor data', exact: true })).toBeVisible();
  await expect(page.getByText('UI preview · Nothing will be saved')).toBeVisible();
  await page.getByRole('navigation', { name: 'Select a master for import' }).getByRole('button', { name: 'Courier Partner Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Courier Partner data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Excel template' })).toBeVisible();
});

test('Zone export menu handles keyboard, dismissal, pending guards, failures and late identity changes', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByTestId('button-export-zones');
  let exports = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/admin/zones/export') exports++; });
  await expect(page.getByRole('combobox', { name: 'Zone export format' })).toHaveCount(0);
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true })).toBeFocused();
  expect(exports).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  const menu = await page.getByRole('menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  // Radix's modal menu intentionally hides background content from AT.
  // A pointer outside still dismisses it; target the DOM, not its hidden role.
  await page.locator('h1').click({ force: true });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/zones/export?*', async (route) => {
    await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'zone_unavailable', message: 'Synthetic export unavailable.' } }) });
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  await expect(trigger).toBeDisabled();
  await trigger.dispatchEvent('click');
  await expect.poll(() => exports).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Export failed (Excel).');
  await expect(page.getByRole('alert')).not.toContainText('CSV export failed');
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  await page.unroute('**/api/v1/admin/zones/export?*');

  // A response arriving after logout must not trigger a download.
  let finish;
  const delayed = new Promise((resolve) => { finish = resolve; });
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route('**/api/v1/admin/zones/export?*', async (route) => {
    const response = await route.fetch();
    requested();
    await delayed;
    await route.fulfill({ response });
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await started;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  finish();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(0);
});


for (const mobile of [false, true]) {
  test(`deleted zones ${mobile ? 'mobile' : 'desktop'} history, explicit restore and local isolation`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const name = `${mobile ? 'Mobile' : 'Desktop'} synthetic recovery`;
    const row = await create(page, name);
    await page.getByTestId(`button-toggle-zone-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId(`button-delete-zone-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveCount(0);
    await page.getByTestId('button-zone-trash').click();
    await page.getByTestId('input-search-zones').fill(name);
    await page.getByTestId('select-filter-zones').selectOption('inactive');
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    const record = page.locator(mobile ? `[data-testid="card-zone-${row.id}"]` : 'tr').filter({ has: page.getByTestId(`text-zone-name-${row.id}`) });
    await expect(record).toContainText('Super Admin');
    await expect(page.getByText(mobile ? 'Deleted' : 'Deleted details', { exact: true })).toBeVisible();
    await expect(page.getByTestId(`button-edit-zone-${row.id}`)).toHaveCount(0);
    await expect(page.getByTestId('button-export-zones')).toHaveCount(0);
    await page.getByTestId(`button-restore-zone-${row.id}`).click();
    await expect(page.getByRole('dialog')).toContainText('as inactive, with its original creator');
    // A cancelled confirmation must not mutate the row.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-restore-zone-${row.id}`).click();
    const restoredResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/admin/zones/${row.id}/restore`);
    await page.getByTestId('button-confirm-action').click();
    const restored = await (await restoredResponse).json();
    expect(restored.version).toBe(4);
    expect(restored.createdAt).toBe(row.createdAt);
    expect(restored.createdBy).toBe(row.createdBy);
    expect(restored.status).toBe('inactive');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveCount(0);
    await expect(page.getByTestId('status-zone-feedback')).toContainText('Zone restored');
    await page.getByTestId('button-zone-current').click();
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    await page.reload();
    await page.getByTestId('input-search-zones').fill(name);
    await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('evexia.admin.zones.v1'))).toBe(legacy);
    await page.screenshot({ path: test.info().outputPath('zone-restored.png'), fullPage: true });
  });
}

test('restore conflicts, unavailable storage, stale targets and ambiguous outcomes require explicit recovery', async ({ page }) => {
  await open(page);
  const row = await create(page, 'Synthetic recovery conflict');
  await page.getByTestId(`button-delete-zone-${row.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const replacement = await create(page, 'SYNTHETIC RECOVERY CONFLICT');
  await page.getByTestId('button-zone-trash').click();
  await page.getByTestId('input-search-zones').fill('Synthetic recovery conflict');
  await page.getByTestId(`button-restore-zone-${row.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toContainText('A non-deleted zone already uses this name');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('button-zone-current').click();
  await expect(page.getByTestId(`text-zone-name-${replacement.id}`)).toBeVisible();
  await page.getByTestId(`button-edit-zone-${replacement.id}`).click();
  await page.getByLabel('Zone name *').fill('Synthetic replacement renamed');
  await page.getByTestId('button-save-zone').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-zone-trash').click();
  await page.getByTestId(`button-restore-zone-${row.id}`).click();
  await page.route(`**/api/v1/admin/zones/${row.id}/restore?*`, (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'zone_unavailable', message: 'Persistence temporarily unavailable.' } }),
  }));
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toContainText('Persistence temporarily unavailable');
  await expect(page.getByTestId('button-confirm-action')).toBeEnabled();
  await page.unroute(`**/api/v1/admin/zones/${row.id}/restore?*`);
  // Another session's restore after this confirmation was opened makes it stale.
  await page.evaluate(async (record) => (await import('/src/services/serverZones.js')).restoreZone(record), { id: row.id, version: 2 });
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toContainText('Zone changed or was already restored');
  await expect(page.getByTestId('button-confirm-action')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveCount(0);
  await page.getByTestId('button-zone-current').click();
  await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
  await page.getByTestId(`button-delete-zone-${row.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-zone-trash').click();
  await page.getByTestId(`button-restore-zone-${row.id}`).click();
  let attempts = 0;
  await page.route(`**/api/v1/admin/zones/${row.id}/restore?*`, async (route) => {
    attempts += 1;
    await route.fetch(); // Commit but lose the response; never auto-replay.
    await route.abort('failed');
  });
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toContainText('Save outcome could not be confirmed');
  await expect(page.getByTestId('button-confirm-action')).toBeDisabled();
  expect(attempts).toBe(1);
  await page.unroute(`**/api/v1/admin/zones/${row.id}/restore?*`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId(`text-zone-name-${row.id}`)).toHaveCount(0);
  await page.getByTestId('button-zone-current').click();
  await expect(page.getByTestId(`text-zone-name-${row.id}`)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.zones.v1'))).toBe(legacy);
});
