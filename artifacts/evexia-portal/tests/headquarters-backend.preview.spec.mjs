import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/headquarters';
const key = 'evexia.admin.headquarters.v1';
const legacy = '[{"id":"legacy-hq","name":"Unused local HQ","stateCode":"OLD","status":"active"}]';
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
  await expect(page.getByRole('heading', { name: 'Import Headquarter Master', exact: true })).toBeVisible();
  for (const format of ['csv', 'xlsx']) {
    await page.getByLabel('Headquarter sample format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-headquarter-template.${format}`);
    const bytes = await readFile(await file.path());
    expect(format === 'xlsx' ? bytes.subarray(0, 2).toString() : bytes.toString().includes('HQ Name,State Code,Status')).toBe(format === 'xlsx' ? 'PK' : true);
  }
  const bytes = Buffer.from('HQ Name,State Code,Status\nTransfer North,,active\nTransfer South,manual,inactive');
  await page.getByTestId('input-headquarter-import').setInputFiles({ name: 'headquarters.csv', mimeType: 'text/csv', buffer: bytes });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'Review rows' })).toBeVisible();
  const details = page.getByRole('list', { name: 'Headquarter import rows' });
  await details.locator('summary').first().click();
  await expect(details).toContainText('TN');
  await details.locator('summary').nth(1).click();
  await expect(details).toContainText('MANUAL');
  await page.getByRole('button', { name: 'Confirm import 2 headquarters' }).click();
  await expect(page.getByRole('status')).toContainText('2 headquarters imported');
  await page.getByRole('button', { name: 'Back to headquarters' }).click();
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
  await page.getByPlaceholder('Search by HQ name or code').fill('Transfer');
  await expect(page.getByTestId('text-headquarter-count')).toContainText('of 2');
  await page.getByLabel('Rows per page').selectOption('2');
  for (const format of ['csv', 'xlsx']) {
    await page.getByLabel('Headquarter export format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`evexia-headquarter-master.${format}`);
    const bytes = await readFile(await file.path());
    if (format === 'csv') {
      expect(bytes.toString()).toContain('Created By,Created At,Updated By,Updated At');
      expect(bytes.toString()).toContain('Transfer North,TN,active,Super Admin');
      expect(bytes.toString()).toContain('Transfer South,MANUAL,inactive,Super Admin');
    } else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  await page.goto(`${base()}/admin/download-logs`);
  await expect(page.getByRole('heading', { name: 'Download Logs', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Headquarter Master');
  await page.goto(`${base()}${path}`);
  await expect(page.getByTestId('text-headquarter-count')).toBeVisible();
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByTestId('input-headquarter-import').setInputFiles({ name: 'uncertain.csv', mimeType: 'text/csv', buffer: Buffer.from('HQ Name,State Code,Status\nUncertain Import,,active') });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByRole('heading', { name: 'Review rows' })).toBeVisible();
  await page.route('**/api/v1/admin/headquarters/import/commit?*', (route) => route.abort());
  await page.getByRole('button', { name: 'Confirm import 1 headquarters' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Confirm import/ })).toHaveCount(0);
  await page.unroute('**/api/v1/admin/headquarters/import/commit?*');
  await page.getByRole('button', { name: 'Refresh authoritative state' }).click();
  await expect(page.getByRole('button', { name: 'Upload & review' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('headquarter-import.png'), fullPage: true });
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
