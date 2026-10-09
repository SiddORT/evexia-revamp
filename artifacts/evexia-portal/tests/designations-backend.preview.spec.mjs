import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const key = 'evexia.admin.designations.v1';
const legacy = '[{"id":"local-only","name":"Untouched browser designation"}]';
const headers = 'Designation Name,Short Name,Level,Status,Basic + DA (%),HRA (%),Medical Allowance (%),Travelling Allowance (%),Special Allowance (%),professional tax (Rs)';
const currentHeaders = 'Designation Name,Short Name,Status';
async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(`${base()}/admin/masters/designations`);
  await expect(page.getByTestId('text-designation-count')).toBeVisible();
}
async function create(page, name) {
  await page.getByTestId('button-add-designation').click();
  await page.getByTestId('input-designation-name').fill(name);
  await page.getByTestId('input-designation-shortName').fill('SYN');
  for (const field of ['level', 'basicDa', 'hra', 'medicalAllowance', 'travellingAllowance', 'specialAllowance', 'professionalTax']) {
    await expect(page.getByTestId(`input-designation-${field}`)).toHaveCount(0);
  }
  await page.getByTestId('select-designation-status').selectOption('active');
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/designations' && r.request().method() === 'POST');
  await page.getByTestId('button-save-designation').click();
  const row = await (await response).json();
  await expect(page.getByTestId(`text-designation-name-${row.id}`)).toHaveText(name);
  return row;
}
for (const mobile of [false, true]) {
  test(`designation ${mobile ? 'mobile' : 'desktop'} persistence, retained draft, conflicts and soft delete`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.getByText('Untouched browser designation', { exact: true })).toHaveCount(0);
    const row = await create(page, `Synthetic ${mobile ? 'mobile' : 'desktop'} designation`);
    const record = page.locator(mobile ? `[data-testid="card-designation-${row.id}"]` : 'tr').filter({ has: page.getByTestId(`text-designation-name-${row.id}`) });
    await expect(record).toContainText('Super Admin');
    const timestamp = await page.evaluate(async (at) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('dateFormat', 'yyyy-mm-dd');
      prefs.setAdminPreference('timeZone', 'UTC');
      prefs.setAdminPreference('clock', '24');
      return prefs.formatAdminTimestamp(at);
    }, row.createdAt);
    await expect(record).toContainText(timestamp);
    await page.evaluate((key) => localStorage.removeItem(key), key);
    await page.reload();
    await expect(page.getByTestId(`text-designation-name-${row.id}`)).toBeVisible();
    await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
    await page.getByTestId(`button-edit-designation-${row.id}`).click();
    await expect(page.getByTestId('input-designation-shortName')).toHaveValue('SYN');
    await page.getByTestId('input-designation-name').fill(row.name + ' edited');
    await page.getByTestId('input-designation-shortName').fill('EDITED');
    await page.evaluate(async (row) => {
      const { editDesignation } = await import('/src/services/serverDesignations.js');
      const { name, shortName, status } = row;
      await editDesignation(row, { name: name + ' concurrent', shortName, status });
    }, row);
    await page.getByTestId('button-save-designation').click();
    await expect(page.getByRole('alert')).toContainText('changed');
    await expect(page.getByTestId('button-save-designation')).toBeDisabled();
    await page.getByTestId('button-refresh-designation-error').click();
    await expect(page.getByRole('alert')).toContainText('concurrent');
    await expect(page.getByTestId('input-designation-shortName')).toHaveValue('EDITED');
    await page.getByTestId('button-save-designation').click();
    await expect(page.getByTestId(`text-designation-name-${row.id}`)).toHaveText(row.name + ' edited');
    await page.getByTestId(`button-toggle-designation-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('select-filter-designations').selectOption('inactive');
    await page.getByTestId('input-search-designations').fill('SYN');
    await expect(page.getByTestId(`text-designation-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-toggle-designation-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('select-filter-designations').selectOption('active');
    await expect(page.getByTestId(`text-designation-name-${row.id}`)).toBeVisible();
    await page.getByTestId(`button-delete-designation-${row.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-designation-name-${row.id}`)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
  });
}

test('designation review, exact CSV/XLSX bytes, download ledger and uncertain commit', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  await page.getByTestId('button-import-designations').click();
  for (const format of ['CSV', 'Excel']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${format} sample`, exact: true }).click();
    const file = await download;
    const bytes = await readFile(await file.path());
    expect(file.suggestedFilename()).toBe(`evexia-designation-template.${format === 'CSV' ? 'csv' : 'xlsx'}`);
    if (format === 'CSV') expect(bytes.toString('utf8')).toContain(currentHeaders);
    else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  await page.getByTestId('input-designation-import').setInputFiles({ name: 'designation.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`${headers}\nSynthetic imported designation,IMP,4,active,0.10,0.20,,,,`) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('button-confirm-designation-import')).toBeEnabled();
  await page.getByTestId('button-confirm-designation-import').click();
  await expect(page.getByRole('status')).toContainText('imported into shared server records');
  await page.getByRole('button', { name: 'Back to Designation Master' }).click();
  await page.getByTestId('input-search-designations').fill('Synthetic imported designation');
  await expect(page.getByTestId('text-designation-count')).toContainText('1');
  for (const format of ['CSV', 'Excel (.xlsx)']) {
    await page.getByTestId('button-export-designations').click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: format, exact: true }).click();
    const file = await download;
    const bytes = await readFile(await file.path());
    if (format === 'CSV') expect(bytes.toString('utf8')).toContain(`${currentHeaders},Created By,Created At,Updated By,Updated At`);
    else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  const after = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  expect(after).toBe(before + 4);
  await page.getByTestId('button-import-designations').click();
  await page.getByTestId('input-designation-import').setInputFiles({ name: 'uncertain.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`${currentHeaders}\nSynthetic uncertain import,UNC,active`) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('button-confirm-designation-import')).toBeEnabled();
  await page.route('**/api/v1/admin/designations/import/commit?*', (route) => route.abort());
  await page.getByTestId('button-confirm-designation-import').click();
  await expect(page.getByRole('alert')).toContainText('inspect');
  await expect(page.getByTestId('button-confirm-designation-import')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload & review', exact: true })).toBeDisabled();
});

test('designation drafts survive renewal; ambiguous create requires reconciliation; logout clears drafts', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-designation').click();
  await page.getByTestId('input-designation-name').fill('Unsaved synthetic draft');
  await page.getByTestId('input-designation-shortName').fill('DRAFT');
  await page.getByTestId('select-designation-status').selectOption('active');
  await page.evaluate(() => { window.draftNode = document.getElementById('designation-name'); });
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-designation-name')).toHaveValue('Unsaved synthetic draft');
  expect(await page.evaluate(() => window.draftNode === document.getElementById('designation-name'))).toBe(true);
  await page.route('**/api/v1/admin/designations?*', (route) => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByTestId('button-save-designation').click();
  await expect(page.getByRole('alert')).toContainText('inspect');
  await expect(page.getByTestId('button-save-designation')).toBeDisabled();
  await page.unroute('**/api/v1/admin/designations?*');
  await page.getByTestId('button-refresh-designation-error').click();
  await expect(page.getByTestId('button-save-designation')).toBeEnabled();
  await expect(page.getByTestId('input-designation-name')).toHaveValue('Unsaved synthetic draft');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(page.getByTestId('input-designation-name')).toHaveCount(0);
});
