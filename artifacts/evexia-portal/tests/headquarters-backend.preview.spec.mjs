import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { checkExportMenuStyles } from './helpers/export-menu-styles.mjs';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/headquarters';
const key = 'evexia.admin.headquarters.v1';
const legacy = '[{"id":"legacy-hq","name":"Unused local HQ","stateCode":"OLD","status":"active"}]';
const importPath = '/admin/masters/import/headquarter';
const hqFile = (name, rows) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`HQ Name,State Code,Status\n${rows}`) });
function workbookRows(bytes) {
  return JSON.parse(execFileSync('python3', ['-c', 'import io,json,sys,openpyxl;print(json.dumps(list(openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()),read_only=True).active.values)))'], { input: bytes, encoding: 'utf8' }));
}
async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => {
    localStorage.setItem(key, legacy);
    sessionStorage.setItem('evexia-headquarter-draft:new', JSON.stringify({ name: 'Unused legacy draft', stateCode: 'OLD', status: 'active' }));
  }, { key, legacy });
  await page.goto(`${base()}${path}`);
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
}
async function create(page, name) {
  await page.getByRole('button', { name: 'Add headquarter', exact: true }).click();
  await expect(page.getByTestId('input-headquarter-name')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Regenerate from HQ name/ })).toHaveCount(0);
  await expect(page.getByText(/Automatic abbreviation|official geographic state code|Drafts stay in memory/)).toHaveCount(0);
  await page.getByTestId('input-headquarter-name').fill('Mumbai');
  await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue('MU');
  await page.getByTestId('input-headquarter-name').fill('North Mumbai');
  await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue('NM');
  await page.getByTestId('input-headquarter-state-code').fill('own');
  await page.getByTestId('input-headquarter-name').fill(name);
  await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue('OWN');
  await page.getByTestId('select-headquarter-status').selectOption('active');
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/headquarters' && response.request().method() === 'POST');
  await page.getByTestId('button-save-headquarter').click();
  const saved = await (await response).json();
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
  return saved;
}
for (const mobile of [false, true]) {
  test(`HQ ${mobile ? 'mobile' : 'desktop'} persistence, overrides, stale edit, statuses and confirmed deletion`, async ({ page }, info) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Unused local HQ', { exact: true })).toHaveCount(0);
    const name = `Synthetic ${mobile ? 'Mobile' : 'Desktop'} HQ`;
    const row = await create(page, name);
    const record = page.locator(mobile ? 'article[role=listitem]' : 'tbody tr').filter({ hasText: name });
    await expect(record).toContainText('OWN');
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
    await page.getByTestId('input-headquarter-name').fill(name + ' Edited');
    await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue('OWN');
    await page.getByRole('button', { name: 'Regenerate from HQ name' }).click();
    const expectedCode = mobile ? 'SMHE' : 'SDHE';
    await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue(expectedCode);
    await page.evaluate(async (row) => {
      await (await import('/src/services/serverHeadquarters.js')).editHeadquarter(row, { name: row.name + ' Concurrent', status: 'active' });
    }, row);
    await page.getByTestId('button-save-headquarter').click();
    await expect(page.getByRole('alert')).toContainText('Headquarter changed');
    await expect(page.getByTestId('button-save-headquarter')).toBeDisabled();
    await expect(page.getByTestId('input-headquarter-name')).toHaveValue(name + ' Edited');
    await page.getByRole('button', { name: 'Review current server details (keep draft)' }).click();
    await expect(page.getByRole('alert')).toContainText('Concurrent');
    await page.getByTestId('button-save-headquarter').click();
    await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
    await expect(record).toContainText(expectedCode);
    await page.reload();
    await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
    await expect(record).toContainText(name + ' Edited');
    await page.getByRole('button', { name: `Inactivate ${name} Edited`, exact: true }).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption('inactive');
    await page.getByPlaceholder('Search by HQ name or code').fill(expectedCode);
    await expect(page.getByTestId('text-headquarter-count')).toContainText('of 1');
    await page.screenshot({ path: info.outputPath(`headquarter-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    await page.getByRole('button', { name: `Activate ${name} Edited`, exact: true }).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(record).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption('all');
    await expect(record).toContainText(name + ' Edited');
    await page.getByRole('button', { name: `Delete ${name} Edited`, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Server deletion history is retained');
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(record).toHaveCount(0);
  });
}

test('HQ CSV/XLSX review, override preservation, actual downloads, ledger and uncertain confirmation', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import Headquarter data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Headquarter Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Headquarter sample format')).toHaveCount(0);
  let excelSample;
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: format === 'csv' ? 'Download CSV sample' : 'Download Excel sample' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-headquarter-template.${format}`);
    const bytes = await readFile(await file.path());
    expect(format === 'xlsx' ? bytes.subarray(0, 2).toString() : bytes.toString().includes('HQ Name,State Code,Status')).toBe(format === 'xlsx' ? 'PK' : true);
    if (format === 'xlsx') {
      expect(workbookRows(bytes)[0]).toEqual(['HQ Name', 'State Code', 'Status']);
      excelSample = bytes;
    }
  }
  await page.getByTestId('input-headquarter-import').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excelSample });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByTestId('headquarter-excel-report').locator('.excel-import__valid')).toHaveText('1 valid');
  const bytes = Buffer.from('HQ Name,State Code,Status\nTransfer North,,active\nTransfer South,manual,inactive');
  await page.getByTestId('input-headquarter-import').setInputFiles({ name: 'headquarters.csv', mimeType: 'text/csv', buffer: bytes });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'headquarters.csv' })).toBeVisible();
  const details = page.getByTestId('headquarter-excel-report');
  await expect(details.locator('.excel-import__valid')).toHaveText('2 valid');
  await expect(details.locator('.excel-import__invalid')).toHaveText('0 invalid');
  await details.locator('summary').first().click();
  await expect(details).toContainText('TN');
  await details.locator('summary').nth(1).click();
  await expect(details).toContainText('MANUAL');
  await page.getByRole('button', { name: 'Confirm import of 2 headquarters' }).click();
  await expect(page.getByRole('status')).toContainText('2 headquarters imported');
  await page.evaluate(async () => (await import('/src/services/serverHeadquarters.js')).createHeadquarter({ name: 'Transfer Extra', state_code: 'EXTRA', status: 'active' }));
  await page.getByRole('button', { name: 'Back to Headquarter Master' }).click();
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
  await page.getByPlaceholder('Search by HQ name or code').fill('Transfer');
  await expect(page.getByTestId('text-headquarter-count')).toContainText('of 3');
  await page.getByLabel('Rows per page').selectOption('2');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-headquarter-master.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'csv') {
      expect(bytes.toString()).toContain('Created By,Created At,Updated By,Updated At');
      expect(bytes.toString()).toContain('Transfer North,TN,active,Super Admin');
      expect(bytes.toString()).toContain('Transfer South,MANUAL,inactive,Super Admin');
      expect(bytes.toString()).toContain('Transfer Extra,EXTRA,active,Super Admin');
    } else {
      const rows = workbookRows(bytes);
      expect(rows).toHaveLength(4);
      expect(rows.slice(1).map((row) => row.slice(0, 3))).toEqual(expect.arrayContaining([['Transfer North', 'TN', 'active'], ['Transfer South', 'MANUAL', 'inactive']]));
    }
  }
  await page.getByPlaceholder('Search by HQ name or code').fill('manual');
  await page.getByLabel('Status', { exact: true }).selectOption('inactive');
  await expect(page.getByTestId('text-headquarter-count')).toContainText('of 1');
  for (const format of ['csv', 'xlsx']) {
    const download = page.waitForEvent('download');
    await page.getByTestId('button-export-headquarters').click();
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const bytes = await readFile(await (await download).path());
    if (format === 'csv') {
      expect(bytes.toString()).toContain('Transfer South,MANUAL,inactive');
      expect(bytes.toString()).not.toContain('Transfer North');
    } else expect(workbookRows(bytes).slice(1).map((row) => row.slice(0, 3))).toEqual([['Transfer South', 'MANUAL', 'inactive']]);
  }
  await page.goto(`${base()}/admin/download-logs`);
  await expect(page.getByRole('heading', { name: 'Download Logs', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Headquarter Master');
  await page.goto(`${base()}${path}`);
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByTestId('input-headquarter-import').setInputFiles({ name: 'uncertain.csv', mimeType: 'text/csv', buffer: Buffer.from('HQ Name,State Code,Status\nUncertain Import,,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByTestId('headquarter-excel-report')).toBeVisible();
  await page.route('**/api/v1/admin/headquarters/import/commit?*', (route) => route.abort());
  await page.getByRole('button', { name: 'Confirm import of 1 headquarters' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Confirm import/ })).toHaveCount(0);
  await page.unroute('**/api/v1/admin/headquarters/import/commit?*');
  await page.getByTestId('input-headquarter-import').setInputFiles(hqFile('uncertain-replacement.csv', 'Uncertain Replacement,,active'));
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.route('**/api/v1/admin/headquarters?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Synthetic authoritative read unavailable.' } }) }));
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Headquarter service is unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await page.unroute('**/api/v1/admin/headquarters?*');
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('headquarter-import.png'), fullPage: true });
});

test('HQ direct import, row errors, replacement, renewal and failed confirmation consume review', async ({ page }, info) => {
  await open(page);
  await page.goto(`${base()}${importPath}`);
  const picker = page.getByTestId('input-headquarter-import');
  const report = page.getByTestId('headquarter-excel-report');
  await expect(page.getByRole('button', { name: 'Headquarter Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.excel-import__number')).toHaveText(['01', '02']);
  await picker.setInputFiles(hqFile('invalid.csv', 'Review Good,,active\n123,,unknown'));
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report.locator('.excel-import__valid')).toHaveText('1 valid');
  await expect(report.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await expect(report.locator('.excel-import__row--invalid')).toContainText('State Code');
  await expect(report.locator('.excel-import__row--invalid li')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: /Confirm import/ })).toBeDisabled();

  let arrived, release, complete;
  const started = new Promise((resolve) => { arrived = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const finished = new Promise((resolve) => { complete = resolve; });
  await page.route('**/api/v1/admin/headquarters/import/review?*', async (route) => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
    complete();
  });
  await picker.setInputFiles(hqFile('old.csv', 'Obsolete Review,,active'));
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await started;
  await picker.setInputFiles(hqFile('replacement.csv', 'Replacement HQ,own,active'));
  release();
  await finished;
  await page.unroute('**/api/v1/admin/headquarters/import/review?*');
  await expect(report).toHaveCount(0);
  await expect(page.locator('.excel-import__picker')).toContainText('replacement.csv');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  expect(await picker.evaluate((node) => node.files[0].name)).toBe('replacement.csv');
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report).toContainText('replacement.csv');
  await report.locator('summary').click();
  await expect(report).toContainText('OWN');
  const before = await page.evaluate(async () => (await (await import('/src/services/serverHeadquarters.js')).listHeadquarters({ query: 'Replacement HQ' })).filtered);
  expect(before).toBe(0);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(report).toBeVisible();
  await page.route('**/api/v1/admin/headquarters/import/commit?*', (route) => route.fulfill({
    status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'headquarter_duplicate', message: 'Synthetic conflict; review again.' } }),
  }));
  await page.getByRole('button', { name: /Confirm import/ }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic conflict');
  await expect(report).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.unroute('**/api/v1/admin/headquarters/import/commit?*');
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(async (appearance) => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('appearance', appearance), appearance);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`hq-import-${width}-${appearance}.png`), fullPage: true });
    }
  }
  await page.getByRole('button', { name: /Confirm import/ }).click();
  await expect(page.getByRole('status')).toContainText('1 headquarters imported');
  await picker.setInputFiles(hqFile('duplicate.csv', 'Replacement HQ,,active'));
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(report.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await expect(page.getByRole('button', { name: /Confirm import/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Zone Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Zone data', exact: true })).toBeVisible();
});

test('HQ menu themes, keyboard dismissal, pending focus, ledger rejection and late identity guard', async ({ page }, info) => {
  test.setTimeout(90000);
  await open(page);
  const trigger = page.getByTestId('button-export-headquarters');
  let requests = 0, downloads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/admin/headquarters/export') requests++; });
  page.on('download', () => downloads++);
  await expect(page.getByRole('combobox', { name: 'Headquarter export format' })).toHaveCount(0);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await checkExportMenuStyles(page, 'button-export-headquarters', 150);
    await trigger.click();
    const bounds = await page.getByRole('menu').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    await page.screenshot({ path: info.outputPath(`hq-export-menu-${width}.png`) });
    await page.locator('h1').click({ force: true });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(requests).toBe(0);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/headquarters/export?*', async (route) => {
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
  await page.unroute('**/api/v1/admin/headquarters/export?*');

  // Missing durable acceptance must also fail closed even with successful bytes.
  await page.route('**/api/v1/admin/headquarters/export?*', (route) => route.fulfill({ status: 200, contentType: 'text/csv', body: 'not accepted' }));
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Export failed (CSV)');
  expect(downloads).toBe(0);
  await page.unroute('**/api/v1/admin/headquarters/export?*');
  let arrived, finish;
  const started = new Promise((resolve) => { arrived = resolve; });
  const delayed = new Promise((resolve) => { finish = resolve; });
  await page.route('**/api/v1/admin/headquarters/export?*', async (route) => {
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

test('HQ authenticated samples fail closed and replacement discards pending downloads', async ({ page }) => {
  await open(page);
  await page.goto(`${base()}${importPath}`);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/v1/admin/headquarters/sample?*', (route) => route.fulfill({ status: 200, body: 'missing acceptance' }));
  for (const name of ['Download CSV sample', 'Download Excel sample']) {
    await page.getByRole('button', { name }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(downloads).toBe(0);
  }
  await page.unroute('**/api/v1/admin/headquarters/sample?*');
  let sampleArrived, sampleRelease, sampleRequests = 0;
  const sampleStarted = new Promise((resolve) => { sampleArrived = resolve; });
  const sampleHeld = new Promise((resolve) => { sampleRelease = resolve; });
  await page.route('**/api/v1/admin/headquarters/sample?*', async (route) => {
    sampleRequests++;
    const response = await route.fetch();
    sampleArrived();
    await sampleHeld;
    await route.fulfill({ response });
  });
  const sampleButton = page.getByRole('button', { name: 'Download CSV sample' });
  await sampleButton.click();
  await sampleStarted;
  await sampleButton.dispatchEvent('click');
  expect(sampleRequests).toBe(1);
  await page.getByTestId('input-headquarter-import').setInputFiles(hqFile('sample-replacement.csv', 'Replaced During Sample,,active'));
  sampleRelease();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(0);
});

test('HQ review cannot return after logout', async ({ page }) => {
  await open(page);
  await page.goto(`${base()}${importPath}`);
  let arrived, release;
  const started = new Promise((resolve) => { arrived = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/headquarters/import/review?*', async (route) => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
  });
  await page.getByTestId('input-headquarter-import').setInputFiles(hqFile('logout.csv', 'Discard Draft,,active'));
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await started;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('headquarter-excel-report')).toHaveCount(0);
});

test('HQ drafts survive same-identity renewal and uncertain create requires reconciliation; logout removes drafts', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add headquarter', exact: true }).click();
  await page.getByTestId('input-headquarter-name').fill('Unsaved Synthetic Draft');
  await page.getByTestId('input-headquarter-state-code').fill('MY');
  await page.getByTestId('select-headquarter-status').selectOption('active');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-headquarter-name')).toHaveValue('Unsaved Synthetic Draft');
  await expect(page.getByTestId('input-headquarter-state-code')).toHaveValue('MY');
  await page.route('**/api/v1/admin/headquarters?*', (route) => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByTestId('button-save-headquarter').click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByTestId('button-save-headquarter')).toBeDisabled();
  await page.unroute('**/api/v1/admin/headquarters?*');
  await page.getByRole('button', { name: 'Review current server details (keep draft)' }).click();
  await expect(page.getByTestId('button-save-headquarter')).toBeEnabled();
  await expect(page.getByTestId('input-headquarter-name')).toHaveValue('Unsaved Synthetic Draft');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(page.getByTestId('input-headquarter-name')).toHaveCount(0);
});
