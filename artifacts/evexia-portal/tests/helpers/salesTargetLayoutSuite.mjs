import { expect } from '@playwright/test';
import { authenticateAdmin } from './authenticateAdmin.mjs';
import { enlargeTargetText, expectTargetFits, targetKeyboardReach } from './salesTargetLayout.mjs';
import { registerSalesTargetToolbar } from './salesTargetToolbarSuite.mjs';

const path = '/admin/masters/sales-targets';
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const header = 'Employee Code,Start Year,End Year,Q1,Q2,Q3,Q4,Status';

export function registerSalesTargetLayout(test, seed) {
  test.describe('@sales-target-layout', () => {
    let refs, record;
    test.beforeAll(async ({ browser, browserName }, info) => {
      test.setTimeout(120000);
      console.log(`Sales Target engine: ${browserName} ${browser.version()} (WebKit is not native Safari)`);
      await info.attach('engine-version', { body: JSON.stringify({ engine: browserName, version: browser.version() }), contentType: 'application/json' });
      const page = await browser.newPage();
      const uncaught = [];
      page.on('pageerror', (error) => uncaught.push(error.message));
      try {
        // One MR per engine, not per case: keep the real actor/hour credential
        // budget intact. Unique seed identities also survive worker restarts.
        refs = await seed(page);
        record = await page.evaluate(async (mrId) => (await import('/src/services/serverSalesTargets.js')).createSalesTarget({
          mrId, startYear: 1980, endYear: 1981, q1: '999999999999.99', q2: '0.01', q3: '0.01', q4: '0.01', status: 'active',
        }), refs.mr.id);
      } finally {
        await info.attach('seed-browser-errors', { body: JSON.stringify(uncaught), contentType: 'application/json' });
        await page.close();
        expect(uncaught, 'Reference setup must not throw browser errors').toEqual([]);
      }
    });

    registerSalesTargetToolbar(test, () => ({ refs, record }));

    for (const width of [390, 1440]) for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
      test(`200% text ${width}px ${theme}/${appearance}: financial years, paged references, actions, import and export`, async ({ page }, info) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width, height: 960 });
        await authenticateAdmin(page);
        await page.goto(base() + path);
        await expect(page.getByTestId('button-add-sales-target')).toBeVisible();
        await page.evaluate(async ({ theme, appearance }) => {
          const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
          setAdminPreference('theme', theme); setAdminPreference('appearance', appearance);
        }, { theme, appearance });
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
        await page.getByTestId('input-search-sales-targets').fill(refs.mr.name.split('-').at(-1));
        const row = page.getByTestId(`${width < 901 ? 'card' : 'row'}-sales-target-${record.id}`);
        await expect(row).toBeVisible();
        const original = await page.getByTestId('button-add-sales-target').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        await enlargeTargetText(page);
        expect(await page.getByTestId('button-add-sales-target').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(original * 2);
        for (const [key, amount] of [['q1', '₹9,99,99,99,99,999.99'], ['q2', '₹0.01'], ['q3', '₹0.01'], ['q4', '₹0.01'], ['total', '₹10,00,00,00,00,000.02']]) {
          await expect(page.getByTestId(`text-sales-target-total-${key}`)).toHaveText(amount);
        }
        await expect(row).toContainText('1980–1981');
        await expect(row).toContainText('Active');
        await expectTargetFits(page, '.admin-target-page');
        const edit = page.getByTestId(`button-edit-sales-target-${width < 901 ? 'mobile-' : ''}${record.id}`);
        await targetKeyboardReach(page, page.getByTestId('button-add-sales-target'), edit);
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('input-sales-target-q1')).toHaveValue('999999999999.99');
        const quarter = page.getByTestId('input-sales-target-q1');
        const font = await quarter.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        await enlargeTargetText(page);
        expect(await quarter.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(font * 2);
        for (const key of ['q2', 'q3', 'q4']) await expect(page.getByTestId(`input-sales-target-${key}`)).toHaveValue('0.01');
        await expectTargetFits(page, '.admin-target-dialog');
        await page.screenshot({ path: info.outputPath('form-200-percent.png') });
        const year = page.getByTestId('select-sales-target-startYear');
        await year.fill('1980');
        await expect(page.getByRole('option', { name: '1980', exact: true })).toBeVisible();
        await enlargeTargetText(page);
        await expectTargetFits(page, '#sales-target-startYear-options');
        await year.press('ArrowDown'); await year.press('Enter');
        await expect(year).toBeFocused(); await expect(year).toHaveValue('1980');
        await targetKeyboardReach(page, year, page.getByRole('button', { name: 'Clear financial start year', exact: true }));
        await page.keyboard.press('Enter');
        await expect(year).toBeFocused();
        await year.fill('1980'); await year.press('ArrowDown'); await year.press('Enter');
        await year.click(); await year.fill('not-a-year');
        await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
        await year.press('Escape');
        await expect(year).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(year).toBeFocused(); await expect(year).toHaveValue('1980');
        await year.click();
        await page.getByRole('heading', { name: 'Edit sales target', exact: true }).click();
        await expect(year).toHaveAttribute('aria-expanded', 'false');
        const endYear = page.getByTestId('select-sales-target-endYear');
        await endYear.fill('1981');
        await expect(page.getByRole('option', { name: '1981', exact: true })).toBeVisible();
        await enlargeTargetText(page); await expectTargetFits(page, '#sales-target-endYear-options');
        await endYear.press('ArrowDown'); await endYear.press('Enter');
        await expect(endYear).toHaveValue('1981');
        const mr = page.getByTestId('select-sales-target-mr');
        await mr.fill(refs.mr.employeeCode);
        await expect(page.getByRole('option', { name: `${refs.mr.name} (${refs.mr.employeeCode})`, exact: true })).toBeVisible();
        await enlargeTargetText(page); await expectTargetFits(page, '#sales-target-mr-options');
        await mr.press('Escape');
        await expect(mr).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('dialog')).toBeVisible(); await expect(mr).toBeFocused();
        await quarter.focus();
        await quarter.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(edit).toBeFocused();
        for (const action of ['toggle', 'delete']) {
          const trigger = page.getByTestId(`button-${action}-sales-target-${width < 901 ? 'mobile-' : ''}${record.id}`);
          await targetKeyboardReach(page, edit, trigger); await page.keyboard.press('Enter');
          await expect(page.getByTestId('button-confirm-action')).toBeEnabled();
          await enlargeTargetText(page); await expectTargetFits(page, '.admin-dialog');
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0); await expect(trigger).toBeFocused();
        }
        const summary = page.getByTestId('button-sales-target-summary');
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(page.getByTestId('text-summary-total')).toHaveText('₹10,00,00,00,00,000.02');
        await enlargeTargetText(page); await expectTargetFits(page, '.admin-target-summary-dialog');
        await page.keyboard.press('Escape');
        await expect(summary).toBeFocused();

        // Bound UI-only page responses use the real synthetic identity. The
        // second-page item remains a valid server MR/zone; no accounts forged.
        const requests = [];
        await page.route('**/api/v1/admin/sales-targets/choices?*', async (route) => {
          const params = new URL(route.request().url()).searchParams;
          const response = await route.fetch();
          const data = await response.json();
          const zoneMode = params.get('limit') === '1';
          const offset = Number(params.get(zoneMode ? 'zoneOffset' : 'offset') || 0);
          requests.push({ zoneMode, offset });
          if (zoneMode) {
            data.zones = offset ? [refs.zone] : [refs.otherZone]; data.zonesTotal = 2;
          } else {
            data.mrs = offset ? [refs.mr] : [{ ...refs.mr, id: refs.otherZone.id, name: 'Synthetic first page MR', employeeCode: 'FIRST-PAGE' }];
            data.total = 2;
          }
          try {
            await route.fulfill({ response, json: data });
          } catch (error) {
            // A clearing request can outlive its popup; the browser may
            // dispose that route while the real response is being fetched.
            if (!/Route is already handled!/.test(error.message)) throw error;
          }
        });
        await expect(page.getByTestId('select-filter-sales-target-zone')).toBeHidden();
        await page.getByTestId('button-toggle-sales-target-filters').click();
        for (const [id, label, value] of [
          ['filter-sales-target-zone', 'Zone', refs.zone.name],
          ['filter-sales-target-mr', 'MR', `${refs.mr.name} (${refs.mr.employeeCode})`],
        ]) {
          const input = page.getByTestId(`select-${id}`);
          await input.click();
          const more = page.getByTestId(`button-more-${id}`);
          await expect(more).toBeVisible();
          await enlargeTargetText(page);
          await expectTargetFits(page, `#${id}-options`);
          await targetKeyboardReach(page, input, more); await page.keyboard.press('Enter');
          await expect(page.getByRole('option', { name: value, exact: true })).toBeVisible();
          await enlargeTargetText(page);
          await expectTargetFits(page, `#${id}-options`);
          await input.focus(); await input.press('ArrowDown'); await input.press('ArrowDown'); await input.press('Enter');
          await expect(input).toHaveValue(value); await expect(input).toBeFocused();
          await enlargeTargetText(page); await expectTargetFits(page, '.admin-target-toolbar');
          await input.click(); await input.press('Escape'); await expect(input).toHaveAttribute('aria-expanded', 'false');
          await targetKeyboardReach(page, input, page.getByRole('button', { name: `Clear ${label.toLowerCase()}`, exact: true }));
          await page.keyboard.press('Enter'); await expect(input).toBeFocused();
          await input.press('Escape'); await expect(input).toHaveValue('');
        }
        expect(requests).toContainEqual({ zoneMode: true, offset: 1 });
        expect(requests).toContainEqual({ zoneMode: false, offset: 1 });
        // Clearing refocuses the input and may start a final reference request.
        // WebKit can still be inside route.fetch here; drain its handler before
        // teardown instead of resuming it underneath a pending fulfillment.
        await page.unrouteAll({ behavior: 'wait' });
        const exportButton = page.getByTestId('button-export-sales-targets');
        await exportButton.focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeFocused();
        await enlargeTargetText(page);
        await expectTargetFits(page, '.sales-target-export-menu');
        await expectTargetFits(page, '.admin-target-page');
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true })).toBeFocused();
        await page.keyboard.press('Escape'); await expect(exportButton).toBeFocused();
        await exportButton.click();
        // Radix's modal menu deliberately disables background pointer targets.
        // A real outside pointer gesture dismisses it; locator.click waits for
        // an interactive background control that is intentionally unavailable.
        await page.mouse.click(4, 4);
        await expect(page.getByRole('menu')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('list-200-percent.png'), fullPage: true });
        await page.getByTestId('button-import-sales-targets').click();
        const picker = page.getByTestId('input-sales-target-import');
        await picker.setInputFiles({ name: 'Synthetic long filename '.repeat(5) + '.csv', mimeType: 'text/csv', buffer: Buffer.from(
          `${header}\n${refs.mr.employeeCode},1986,1987,999999999999.99,0.01,0.01,0.01,active\n${'UNKNOWN_REFERENCE_'.repeat(8)},1988,1989,1.234,2,3,4,invalid`,
        ) });
        await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
        const report = page.getByTestId('sales-target-excel-report');
        await expect(report).toContainText('1 valid'); await expect(report).toContainText('1 invalid');
        await report.locator('details').first().locator('summary').click();
        await expect(report.locator('dd').filter({ hasText: /^999999999999.99$/ })).toBeVisible();
        await expect(report.locator('li').first()).toBeVisible();
        await expect(report).toContainText('Employee Code must match a saved server MR');
        await expect(page.getByTestId('button-confirm-sales-target-import')).toBeDisabled();
        await enlargeTargetText(page);
        await expectTargetFits(page, '.excel-import--sales-target');
        await targetKeyboardReach(page, report.locator('summary').first(), report.locator('summary').last());
        await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
        await page.screenshot({ path: info.outputPath('import-200-percent.png'), fullPage: true });
      });
    }
  });
}
