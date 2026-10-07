import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { enlargeCourierText, expectCourierContentFits, tabToCourierControl } from './helpers/courierImportLayout.mjs';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const file = (name) => ({ name: `${name}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Courier Partner Name,Status\n${name},Active`) });
async function open(page, importing = true) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}/admin/masters/${importing ? 'import/courier-partner' : 'courier-partners'}`);
  await expect(importing ? page.getByRole('heading', { name: 'Import Courier Partner data', exact: true }) : page.getByTestId('text-courier-partner-count')).toBeVisible();
}
const confirm = (page) => page.getByRole('button', { name: 'Confirm import of 1 courier partners', exact: true });

for (const width of [390, 1440]) {
  for (const theme of ['classic', 'modern']) {
    for (const appearance of ['light', 'dark']) {
      test(`Courier 200% text wraps long content and keyboard controls at ${width}px ${theme}/${appearance}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page);
        await page.evaluate(async ({ theme, appearance }) => {
          const preferences = await import('/src/components/admin/adminPreferences.js');
          preferences.setAdminPreference('theme', theme);
          preferences.setAdminPreference('appearance', appearance);
        }, { theme, appearance });
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);

        const name = `Synthetic ${width} ${theme} ${appearance} `.padEnd(200, '界');
        const invalidName = 'Invalid synthetic '.padEnd(200, '配');
        const filename = `配送-échantillon-${'長いファイル名'.repeat(20)}.csv`;
        const longError = `Synthetic row diagnostic: ${'配送先のステータスを確認してください。'.repeat(30)} ${'unbroken-diagnostic-'.repeat(20)}`;
        const picker = page.getByLabel('Courier CSV or Excel file');
        const upload = page.getByRole('button', { name: 'Upload & review', exact: true });
        // Exercise the real authenticated parser. Only the displayed diagnostic
        // is extended synthetically, without relaxing any backend limits.
        await page.route('**/api/v1/admin/courier-partners/import/review?*', async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          const result = await response.json();
          expect(result.rows[1].errors.length).toBeGreaterThan(0);
          result.rows[1].errors.push(longError);
          await route.fulfill({ response, json: result });
        });
        await picker.setInputFiles({ name: filename, mimeType: 'text/csv',
          buffer: Buffer.from(`Courier Partner Name,Status\n${name},Active\n${invalidName},Invalid`) });
        await upload.click();
        const report = page.getByTestId('courier-excel-report');
        await expect(report).toBeVisible();
        await expect(page.locator('.excel-import__valid')).toHaveText('1 valid');
        await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
        await expect(report.locator('li').last()).toHaveText(longError);
        await expect(report.locator('h2')).toHaveText(filename);
        await expect(page.locator('.excel-import__picker span')).toHaveText(filename);
        await expect(page.getByRole('button', { name: 'Confirm import of 2 courier partners' })).toBeDisabled();
        const originalSize = await report.locator('h2').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        expect(await enlargeCourierText(page)).toBe(originalSize * 2);
        await expect(report.locator('h2')).toHaveCSS('font-size', `${originalSize * 2}px`);
        const summary = report.locator('.excel-import__row:not(.excel-import__row--invalid) summary');
        await tabToCourierControl(page, summary);
        await summary.press('Space');
        await expect(report.locator('dd').first()).toHaveText(name);
        await expect(report.locator('dd').first()).toBeVisible();
        await expectCourierContentFits(page);
        await page.screenshot({ path: test.info().outputPath('courier-enlarged-report.png'), fullPage: true });

        for (const [label, extension] of [['Download CSV sample', 'csv'], ['Download Excel sample', 'xlsx']]) {
          const sample = page.getByRole('button', { name: label, exact: true });
          await tabToCourierControl(page, sample);
          const downloading = page.waitForEvent('download');
          await sample.press('Enter');
          const downloaded = await downloading;
          expect(downloaded.suggestedFilename()).toBe(`evexia-courier-partner-master.${extension}`);
          expect((await readFile(await downloaded.path())).length).toBeGreaterThan(0);
        }
        await tabToCourierControl(page, picker);
        await page.unroute('**/api/v1/admin/courier-partners/import/review?*');
        await picker.setInputFiles({ name: filename, mimeType: 'text/csv',
          buffer: Buffer.from(`Courier Partner Name,Status\n${name},Active`) });
        await tabToCourierControl(page, upload);
        await upload.press('Enter');
        await expect(confirm(page)).toBeEnabled();
        await expect(report.locator('h2')).toHaveText(filename);
        await tabToCourierControl(page, report.locator('summary'));
        await report.locator('summary').press('Enter');
        await expect(report.locator('dd').first()).toHaveText(name);
        await expect(report.locator('dd').first()).toBeVisible();
        await expectCourierContentFits(page);
        await tabToCourierControl(page, confirm(page));
        await confirm(page).press('Enter');
        await expect(page.getByRole('status')).toHaveText('1 courier partners imported into shared server records.');
        await expect(report).toHaveCount(0);
        await expect(upload).toBeDisabled();
        await expectCourierContentFits(page);
      });
    }
  }
}

test('Courier prepared layout, CSV sample and master tabs in all desktop/mobile themes', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Courier Partner Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Shared server records', { exact: true })).toBeVisible();
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
    await page.screenshot({ path: test.info().outputPath(`courier-import-${theme}-${appearance}-${width}.png`), fullPage: true });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV sample', exact: true }).click();
  const sample = await download;
  const buffer = await readFile(await sample.path());
  expect(buffer.toString()).toContain('Courier Partner Name,Status');
  await page.getByLabel('Courier CSV or Excel file').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(confirm(page)).toBeEnabled();
  await expect(page.locator('.excel-import__valid')).toHaveText('1 valid');
  const tabs = () => page.getByRole('navigation', { name: 'Select a master for import' });
  for (const master of ['MR', 'Doctor']) {
    await tabs().getByRole('button', { name: `${master} Master`, exact: true }).click();
    await expect(page.getByText(master === 'MR' ? 'Shared server records' : 'UI preview · Nothing will be saved')).toBeVisible();
  }
  await tabs().getByRole('button', { name: 'Zone Master', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import Zone data', exact: true })).toBeVisible();
  await expect(page.getByText('Shared server records', { exact: true })).toBeVisible();
  await tabs().getByRole('button', { name: 'Courier Partner Master', exact: true }).click();
  await expect(page.getByTestId('courier-excel-report')).toHaveCount(0);
});

test('Courier file replacement, duplicate guards, renewal, conflict and uncertain commit recovery', async ({ page }) => {
  await open(page);
  const picker = page.getByLabel('Courier CSV or Excel file');
  const upload = page.getByRole('button', { name: 'Upload & review', exact: true });
  await picker.setInputFiles(file('Courier held review'));
  let release, started;
  const held = new Promise((resolve) => { release = resolve; });
  const requestStarted = new Promise((resolve) => { started = resolve; });
  let attempts = 0;
  await page.route('**/api/v1/admin/courier-partners/import/review?*', async (route) => {
    attempts++;
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response });
  });
  await upload.click();
  await requestStarted;
  await expect(page.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reviewing…' }).dispatchEvent('click');
  expect(attempts).toBe(1);
  await picker.setInputFiles(file('Courier replacement'));
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByTestId('courier-excel-report')).toHaveCount(0);
  await expect(page.locator('.excel-import__picker')).toContainText('Courier replacement.csv');
  let first = true;
  await page.route('**/api/v1/admin/courier-partners/import/review?*', (route) => {
    if (!first) return route.continue();
    first = false;
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
  await upload.click();
  await expect(page.getByRole('alert')).toContainText('Session renewed. Your draft is preserved');
  expect(await picker.evaluate((node) => node.files[0].name)).toBe('Courier replacement.csv');
  await page.unroute('**/api/v1/admin/courier-partners/import/review?*');
  await upload.click();
  await expect(confirm(page)).toBeEnabled();
  await page.evaluate(async () => (await import('/src/services/serverCouriers.js')).createCourier({ name: 'Courier replacement', status: 'inactive' }));
  await confirm(page).click();
  await expect(page.getByRole('alert')).toContainText('Review the file again');
  await expect(confirm(page)).toHaveCount(0);
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
  await picker.evaluate((node) => { window.courierPicker = node; });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession());
  await expect(page.getByRole('button', { name: 'Retry session verification' })).toBeVisible();
  await page.unroute('**/api/v1/auth/me');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(picker).toBeVisible();
  expect(await picker.evaluate((node) => node === window.courierPicker && node.files[0].name === 'Courier replacement.csv')).toBe(true);
  await picker.setInputFiles(file('Courier uncertain import'));
  await upload.click();
  await expect(confirm(page)).toBeEnabled();
  let commits = 0, finish, committing;
  const commitHeld = new Promise((resolve) => { finish = resolve; });
  const commitStarted = new Promise((resolve) => { committing = resolve; });
  await page.route('**/api/v1/admin/courier-partners/import/commit?*', async (route) => {
    commits++;
    await route.fetch();
    committing();
    await commitHeld;
    await route.abort('failed');
  });
  await confirm(page).click();
  await commitStarted;
  await expect(page.getByRole('button', { name: 'Importing…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Importing…' }).dispatchEvent('click');
  expect(commits).toBe(1);
  finish();
  await expect(page.getByRole('alert')).toContainText('Save outcome could not be confirmed');
  await expect(page.getByRole('alert')).toContainText('inspect shared records first');
  await expect(confirm(page)).toHaveCount(0);
  await page.unroute('**/api/v1/admin/courier-partners/import/commit?*');
  await upload.click();
  await expect(page.locator('.excel-import__invalid')).toHaveText('1 invalid');
});

test('Courier late reviews cannot apply after navigation or logout and a new login needs review', async ({ page }) => {
  await open(page);
  for (const identityChange of [false, true]) {
    await page.getByLabel('Courier CSV or Excel file').setInputFiles(file(`Courier late ${identityChange}`));
    let release, started;
    const held = new Promise((resolve) => { release = resolve; });
    const requestStarted = new Promise((resolve) => { started = resolve; });
    await page.route('**/api/v1/admin/courier-partners/import/review?*', async (route) => {
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await requestStarted;
    if (identityChange) {
      await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
      await expect(page.getByTestId('button-submit-login')).toBeVisible();
    } else await page.getByRole('button', { name: 'MR Master', exact: true }).click();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    if (identityChange) await open(page);
    else await page.getByRole('button', { name: 'Courier Partner Master', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import Courier Partner data', exact: true })).toBeVisible();
    await expect(page.getByTestId('courier-excel-report')).toHaveCount(0);
    expect(await page.getByLabel('Courier CSV or Excel file').evaluate((node) => node.files.length)).toBe(0);
  }
});

test('Courier export keyboard/dismissal, pending focus, duplicate guards, format errors and late logout', async ({ page }) => {
  await open(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByTestId('button-export-courier-partners');
  let exports = 0, downloads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/admin/courier-partners/export') exports++; });
  page.on('download', () => downloads++);
  await expect(page.getByRole('combobox', { name: 'Courier export format' })).toHaveCount(0);
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true })).toBeFocused();
  expect(exports).toBe(0);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  const menu = await page.getByRole('menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  await page.locator('h1').click({ force: true });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const format of ['Excel (.xlsx)', 'CSV']) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/v1/admin/courier-partners/export?*', async (route) => {
      await held;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'courier_unavailable', message: 'Synthetic unavailable.' } }) });
    });
    const before = exports;
    await trigger.click();
    await page.getByRole('menuitem', { name: format, exact: true }).click();
    await expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await expect(trigger).not.toHaveAttribute('disabled');
    await expect(trigger).toBeFocused();
    await trigger.press('ArrowDown');
    await trigger.dispatchEvent('click');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect.poll(() => exports).toBe(before + 1);
    release();
    await expect(page.getByRole('alert')).toContainText(`Export failed (${format === 'CSV' ? 'CSV' : 'Excel'}).`);
    await expect(trigger).toBeFocused();
    await page.unroute('**/api/v1/admin/courier-partners/export?*');
  }
  let finish, started;
  const held = new Promise((resolve) => { finish = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  await page.route('**/api/v1/admin/courier-partners/export?*', async (route) => {
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response });
  });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  await requested;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  finish();
  await page.unrouteAll({ behavior: 'wait' });
  expect(downloads).toBe(0);
});
