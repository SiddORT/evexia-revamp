import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/inventory/stock-status';
const fiscalYear = () => { const now = new Date(); return now.getFullYear() - (now.getMonth() < 3 ? 1 : 0); };

async function open(page) {
  await authenticateAdmin(page);
  await page.goto(`${base()}${path}`);
  await expect(page.getByRole('heading', { name: 'Stock status', exact: true })).toBeVisible();
}
async function choose(page, query, identity) {
  await page.getByRole('combobox', { name: 'Allergens', exact: true }).fill(query);
  await page.getByRole('option').filter({ hasText: identity }).click();
}

async function assertStockGeometry(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const region = page.getByRole('region', { name: 'Stock status', exact: true });
  await expect(region).toHaveAttribute('tabindex', '0');
  const geometry = await region.evaluate((node) => {
    const table = node.querySelector('table');
    const row = table.querySelector('tbody tr');
    const cells = [...row.cells];
    const name = cells[0].querySelector('strong');
    const style = getComputedStyle(name);
    return {
      regionWidth: node.clientWidth, tableWidth: table.getBoundingClientRect().width,
      productWidth: cells[0].getBoundingClientRect().width,
      nameLines: name.getBoundingClientRect().height / parseFloat(style.lineHeight),
      rowHeight: row.getBoundingClientRect().height,
      alignments: cells.map((cell) => getComputedStyle(cell).textAlign),
      nowrap: [cells[3], cells[4]].map((cell) => getComputedStyle(cell).whiteSpace),
      columns: cells.length,
    };
  });
  expect(geometry.columns).toBe(6);
  expect(geometry.productWidth).toBeGreaterThanOrEqual(175);
  expect(geometry.nameLines).toBeLessThanOrEqual(2);
  expect(geometry.rowHeight).toBeLessThanOrEqual(70);
  expect(geometry.alignments).toEqual(['left', 'left', 'left', 'right', 'right', 'center']);
  expect(geometry.nowrap).toEqual(['nowrap', 'nowrap']);
  if (width === 390) expect(geometry.tableWidth).toBeGreaterThan(geometry.regionWidth);
  else expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.regionWidth + 1);
  await expect(page.locator('.stock-list-table tbody')).not.toContainText('snapshot');
  for (const id of ['demo-dust', 'demo-grass']) {
    const name = page.getByTestId(`row-stock-${id}`).locator('.admin-table__name');
    expect(await name.evaluate((node) => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight))).toBeLessThanOrEqual(2);
  }
}

test('stock geometry, unclipped options and scoped serial columns across widths and themes', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await open(page);
  await expect(page.locator('.admin-shell')).not.toHaveClass(/admin-shell--collapsed/);
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(async ({ theme, appearance }) => {
      const preferences = await import('/src/components/admin/adminPreferences.js');
      preferences.setAdminPreference('theme', theme);
      preferences.setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    for (const width of [1024, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await assertStockGeometry(page, width);
      const year = await page.getByTestId('select-stock-year').boundingBox();
      const allergens = page.getByRole('combobox', { name: 'Allergens', exact: true });
      const control = await page.locator('.stock-product .searchable-select__control').boundingBox();
      expect(control.height).toBe(year.height);
      if (width > 640) expect(control.y).toBe(year.y);
      const scope = await page.getByTestId('text-stock-scope').boundingBox();
      expect(scope.y).toBeGreaterThanOrEqual(control.y + control.height);
      await allergens.fill('Cedar');
      const options = page.getByRole('listbox', { name: 'Allergens' }).getByRole('option');
      await expect(options).toHaveCount(2);
      const lastOption = options.last();
      await expect(lastOption).toBeInViewport();
      expect(await lastOption.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: test.info().outputPath(`stock-layout-${width}-${theme}-${appearance}.png`), fullPage: true });
    }
  }
  const region = page.getByRole('region', { name: 'Stock status', exact: true });
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  const view = page.getByTestId('button-view-stock-demo-dust');
  await view.click();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  for (const tab of ['purchases', 'orders']) {
    await page.getByTestId(`tab-stock-${tab}`).click();
    const history = dialog.getByRole('region', { name: `${tab} history` });
    await expect(history).toHaveAttribute('tabindex', '0');
    expect(await history.locator('tbody td').first().evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
    expect((await history.locator('tbody td').first().boundingBox()).width).toBeGreaterThan(100);
    await history.focus();
    await expect(history).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => history.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: test.info().outputPath('stock-history-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(view).toBeFocused();
  await page.getByTestId('button-inventory-report').click();
  const reportRegion = page.getByRole('region', { name: 'Sample inventory report table' });
  await reportRegion.focus();
  await expect(reportRegion).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => reportRegion.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  expect(await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('stock-report-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByRole('heading', { name: 'Zone Master', exact: true })).toBeVisible();
  // The isolated database starts empty; create a synthetic serial-table row.
  await page.getByTestId('button-add-zone').click();
  await page.getByLabel('Zone name *').fill('Stock layout isolation check');
  await page.getByTestId('button-save-zone').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const serial = page.locator('.admin-table th').first();
  await expect(serial).toBeVisible();
  expect(await serial.evaluate((node) => ({ width: getComputedStyle(node).width, align: getComputedStyle(node).textAlign }))).toEqual({ width: '58px', align: 'center' });
});

test('direct Stock Status route retains its authentication guard', async ({ page }) => {
  await page.goto(`${base()}${path}`);
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stock status', exact: true })).toHaveCount(0);
});

test('sample snapshot, complete export, combined filters and product histories', async ({ page }) => {
  await open(page);
  const year = fiscalYear();
  await expect(page.getByTestId('select-stock-year')).toHaveValue(String(year));
  await expect(page.getByTestId('select-stock-year').locator('option')).toHaveText([`${year}-${year + 1}`, `${year - 1}-${year}`, `${year - 2}-${year - 1}`]);
  await expect(page.getByTestId('text-stock-disclaimer')).toContainText('not server-backed');
  await expect(page.getByTestId('text-stock-scope')).toContainText('Demo as-of snapshot');
  await expect(page.getByTestId('link-admin-stock-status')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('link-admin-purchase-orders')).toBeVisible();
  await expect(page.getByTestId('link-admin-purchase-received')).toBeVisible();
  await expect(page.locator('.stock-page .admin-table th')).toHaveText(['Product', 'Concentration', 'Category', 'Selling Price', 'Quantity', 'View']);
  // The product fixtures never read or overwrite unrelated records.
  const keys = ['evexia.admin.allergens.v1', 'evexia.admin.purchaseOrders.v1', 'evexia.admin.purchaseReceived.v1', 'evexia.admin.moveStocks.v1'];
  await page.evaluate((keys) => keys.forEach((key) => localStorage.setItem(key, 'unreadable-sentinel')), keys);
  await page.getByLabel('Rows per page').selectOption('2');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-stock-count')).toContainText('Showing 3–4 of 8');
  const download = page.waitForEvent('download');
  await page.getByTestId('button-export-stock').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`stock-status-sample-${year}-${year + 1}.csv`);
  const csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('Sample/demo UI data');
  expect(csv).toContain('"10,000 AU/mL"');
  expect(csv).toContain('"980.50"');
  expect(csv.split('\r\n').length).toBe(10);
  expect(csv).toContain('"Sample Diagnostic Mix"');
  await page.getByTestId('select-stock-year').selectOption(String(year - 1));
  await expect(page.getByTestId('text-stock-count')).toContainText('Showing 1–2 of 7');
  await expect(page.getByTestId('text-stock-scope')).toContainText('Demo year-end snapshot');
  await choose(page, 'Cedar', 'demo-cedar-high');
  await expect(page.locator('.stock-page .admin-table tbody tr')).toHaveCount(1);
  const trigger = page.getByTestId('button-view-stock-demo-cedar-high');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ID demo-cedar-high');
  await expect(dialog).toContainText('orders are demo sales orders, not procurement POs');
  await expect(dialog.getByTestId('select-stock-history-year')).toHaveValue(String(year - 1));
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog.locator('tbody tr')).toContainText(`DEMO-PUR-${year - 1}-4`);
  await dialog.getByTestId('tab-stock-purchases').focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByTestId('tab-stock-orders')).toBeFocused();
  await expect(dialog.getByTestId('tab-stock-orders')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('tbody tr')).toContainText(`DEMO-SALE-${year - 1}-4`);
  await expect(dialog.locator('tbody tr')).toContainText(`31 Mar ${year}`);
  await dialog.getByTestId('select-stock-history-year').selectOption('all');
  await expect(dialog.locator('tbody tr')).toHaveCount(3);
  await expect(dialog.getByTestId('text-stock-history-count')).toContainText('of 3');
  await expect(dialog.locator('tbody')).not.toContainText('DEMO-SALE-' + year + '-3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), keys)).toEqual(keys.map(() => 'unreadable-sentinel'));
});

test('empty results, report print/PDF, error handling and themed snapshot rendering', async ({ page }) => {
  await open(page);
  const year = fiscalYear();
  const keys = ['evexia.admin.allergens.v1', 'evexia.admin.purchaseOrders.v1', 'evexia.admin.purchaseReceived.v1', 'evexia.admin.moveStocks.v1'];
  await page.evaluate((keys) => keys.forEach((key) => localStorage.setItem(key, 'unreadable-sentinel')), keys);
  await page.getByTestId('select-stock-year').selectOption(String(year - 1));
  await choose(page, 'Birch', 'demo-birch');
  await expect(page.locator('.stock-page .admin-table tbody')).toContainText('0 vials');
  await page.getByTestId('button-view-stock-demo-birch').click();
  await expect(page.getByRole('dialog')).toContainText('No purchases in this period');
  await page.getByTestId('tab-stock-orders').click();
  await page.getByTestId('select-stock-history-year').selectOption('all');
  await expect(page.getByRole('dialog')).toContainText('No orders in this period');
  await page.keyboard.press('Escape');
  await choose(page, 'Diagnostic', 'demo-new');
  await expect(page.getByText('No products match these filters', { exact: true })).toBeVisible();
  await page.getByTestId('button-export-stock').click();
  await expect(page.getByRole('alert')).toContainText('There are no rows to export');
  await page.getByTestId('button-inventory-report').click();
  await expect(page.getByRole('dialog')).toContainText('Nothing to report');
  await expect(page.getByTestId('button-print-stock-report')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByTestId('select-stock-year').selectOption(String(year));
  await expect(page.getByTestId('text-stock-count')).toContainText('of 1');
  await choose(page, 'All allergens', 'All allergens');
  await page.getByTestId('button-inventory-report').click();
  const report = page.getByTestId('stock-report');
  await expect(report.locator('tbody tr')).toHaveCount(8);
  await expect(report).toContainText(`${year}-${year + 1}`);
  await expect(report).toContainText('All allergens');
  await expect(report).toContainText('Generated');
  await expect(report).toContainText('not server-backed');
  await page.evaluate(() => { window.print = () => { window.__stockPrintCalls = (window.__stockPrintCalls || 0) + 1; }; });
  await page.getByTestId('button-print-stock-report').click();
  expect(await page.evaluate(() => window.__stockPrintCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.admin-header')).toBeHidden();
  await expect(report).toBeVisible();
  expect(await report.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(17, 17, 17)');
  await page.screenshot({ path: test.info().outputPath('stock-report-print.png'), fullPage: true });
  // Browser PDF output exercises actual print rendering rather than a custom exporter.
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(1000);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { window.print = () => { throw new Error('Synthetic print failure'); }; });
  await page.getByTestId('button-print-stock-report').click();
  await expect(page.getByRole('alert')).toContainText('Try your browser menu');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('Synthetic download failure'); }; });
  await page.getByTestId('button-export-stock').click();
  await expect(page.getByRole('alert')).toContainText('Synthetic download failure');
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), keys)).toEqual(keys.map(() => 'unreadable-sentinel'));
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(async ({ theme, appearance }) => {
      const preferences = await import('/src/components/admin/adminPreferences.js');
      preferences.setAdminPreference('theme', theme);
      preferences.setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    await page.screenshot({ path: test.info().outputPath(`stock-${theme}-${appearance}.png`), fullPage: true });
  }
  // Loading this page must not make print styles hide every subsequent page.
  await page.getByTestId('link-admin-dashboard').click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.admin-header')).toBeVisible();
});

test('collapsed/sidebar search and narrow-screen keyboard navigation', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-toggle-sidebar').click();
  await page.getByTestId('button-toggle-inventory').click();
  await expect(page.getByTestId('link-admin-stock-status')).toBeVisible();
  await page.getByTestId('input-search-navigation').fill('stock status');
  await expect(page.getByTestId('link-admin-stock-status')).toBeVisible();
  await expect(page.getByTestId('link-admin-purchase-orders')).toHaveCount(0);
  await page.getByTestId('button-clear-navigation-search').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('button-open-navigation').click();
  await page.getByTestId('input-search-navigation').fill('stock status');
  await page.getByTestId('link-admin-stock-status').click();
  // Clicking the already active link also closes the mobile drawer.
  await expect(page.getByTestId('button-open-navigation')).toHaveAttribute('aria-expanded', 'false');
  const allergens = page.getByRole('combobox', { name: 'Allergens' });
  await allergens.fill('Cedar');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-stock-count')).toContainText('of 1');
  await expect(page.locator('.stock-page .admin-table tbody')).toContainText('demo-cedar-high');
  await page.getByTestId('button-view-stock-demo-cedar-high').click();
  await expect(page.getByTestId('button-close-dialog')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('button-view-stock-demo-cedar-high')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('stock-mobile.png'), fullPage: true });
});
