import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const path = '/admin/inventory/move-stocks';
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
async function choose(page, label, name) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
  await input.press('Tab');
}
async function open(page, suffix = '') {
  await authenticateAdmin(page);
  await page.goto(`${base()}${path}${suffix}`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await expect(page.getByRole('heading', { name: suffix ? 'Move stock' : 'Move stocks', exact: true })).toBeVisible();
}

test('navigation, searchable sources, validation, transfer, details, balance consistency and reload isolation', async ({ page }) => {
  await open(page);
  const originalStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /allergen|storage-location|purchase|opening|session|auth/i.test(k))));
  await page.getByTestId('input-search-navigation').fill('move stocks');
  await expect(page.getByTestId('link-admin-move-stocks')).toBeVisible();
  await expect(page.getByTestId('link-admin-move-stocks')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('button-clear-navigation-search').click();
  await page.getByTestId('button-view-move-demo-movement-example').click();
  await expect(page.getByRole('dialog')).toContainText('Demo Grass Pollen Allergen');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-new-move').click();
  await expect(page).toHaveURL(new RegExp(`${path}/new$`));
  await page.getByTestId('button-save-move').click();
  await expect(page.locator('#ms-sourceId-error')).toBeVisible();
  await expect(page.locator('#ms-destinationId-error')).toBeVisible();
  await expect(page.locator('#ms-lines-error')).toBeVisible();
  await expect(page.locator('#ms-deliveredBy-error')).toBeVisible();
  await choose(page, 'Source location', 'Demo Main Warehouse');
  await page.getByRole('combobox', { name: 'Destination location' }).click();
  await expect(page.getByRole('option', { name: 'Demo Main Warehouse', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await choose(page, 'Destination location', 'Demo Clinic Store');
  await page.getByTestId('input-move-delivered-by').fill('Synthetic demo courier');
  await page.getByTestId('input-move-date').fill('2026-10-07');
  await page.getByTestId('checkbox-move-product-demo-dust').check();
  const quantity = page.getByTestId('input-move-qty-demo-dust');
  for (const value of ['', '0', '-1', '49', '0.5']) {
    await quantity.fill(value);
    await page.getByTestId('button-save-move').click();
    await expect(quantity).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(new RegExp(`${path}/new$`));
  }
  await quantity.fill('4');
  await page.getByTestId('checkbox-move-product-demo-mould').check();
  await page.getByTestId('input-move-qty-demo-mould').fill('3');
  await expect(page.getByTestId('text-move-totals')).toContainText('4 vials');
  await expect(page.getByTestId('text-move-totals')).toContainText('3 bottles');
  // Two submit events in the same turn exercise the synchronous ref lock.
  await page.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('status-move-feedback')).toContainText('Demo movement recorded');
  await expect(page.locator('[data-testid^="row-move-"]')).toHaveCount(2);
  const row = page.locator('[data-testid^="row-move-"]').first();
  await expect(row).toContainText('Synthetic demo courier');
  await row.getByRole('button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Demo Mould Allergen');
  await expect(dialog.locator('tbody tr').first()).toContainText('4');
  await expect(dialog.locator('tbody tr').last()).toContainText('bottles');
  await page.keyboard.press('Escape');
  await page.getByTestId('button-new-move').click();
  await choose(page, 'Source location', 'Demo Main Warehouse');
  await expect(page.getByTestId('text-move-available-demo-dust')).toHaveText('44 vials');
  await expect(page.getByTestId('text-move-available-demo-mould')).toHaveText('12 bottles');
  await choose(page, 'Source location', 'Demo Clinic Store');
  await expect(page.getByTestId('text-move-available-demo-dust')).toHaveText('16 vials');
  await expect(page.getByTestId('text-move-available-demo-mould')).toHaveText('3 bottles');
  await page.getByTestId('button-cancel-move').click();
  const afterStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /allergen|storage-location|purchase|opening|session|auth/i.test(k))));
  expect(afterStorage).toEqual(originalStorage);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Move stocks', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="row-move-"]')).toHaveCount(1);
});

for (const theme of ['classic', 'modern']) {
  for (const appearance of ['light', 'dark']) {
    test(`${theme} ${appearance}: direct form, keyboard selection, source clearing, empty stock, cancel and mobile navigation`, async ({ page }) => {
      await page.addInitScript(({ theme, appearance }) => {
        localStorage.setItem('evexia.admin.theme', theme);
        localStorage.setItem('evexia.admin.appearance', appearance);
      }, { theme, appearance });
      await open(page, '/new');
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      const source = page.getByRole('combobox', { name: 'Source location', exact: true });
      await source.fill('Warehouse');
      await source.press('ArrowDown');
      await source.press('Enter');
      await source.press('Tab');
      await expect(page.getByTestId('checkbox-move-product-demo-dust')).toBeVisible();
      await choose(page, 'Destination location', 'Demo Clinic Store');
      await page.getByTestId('checkbox-move-product-demo-dust').check();
      await page.getByTestId('input-move-qty-demo-dust').fill('2');
      await choose(page, 'Source location', 'Demo Clinic Store');
      await expect(page.getByRole('combobox', { name: 'Destination location' })).toHaveValue('');
      await expect(page.getByTestId('checkbox-move-product-demo-dust')).not.toBeChecked();
      await expect(page.getByTestId('input-move-qty-demo-dust')).toHaveCount(0);
      await choose(page, 'Source location', 'Demo Cold Room');
      await expect(page.getByTestId('checkbox-move-product-demo-dust')).toHaveCount(0);
      await expect(page.getByTestId('checkbox-move-product-demo-mould')).toBeVisible();
      await choose(page, 'Source location', 'Demo Empty Store');
      await expect(page.getByTestId('text-move-empty-source')).toBeVisible();
      await page.getByTestId('button-back-move').click();
      await expect(page.locator('[data-testid^="row-move-"]')).toHaveCount(1);
      await page.getByTestId('button-toggle-sidebar').click();
      await page.getByTestId('button-toggle-inventory').click();
      await expect(page.getByTestId('link-admin-move-stocks')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId('button-open-navigation').click();
      await page.getByTestId('input-search-navigation').fill('move stocks');
      await page.getByTestId('link-admin-move-stocks').click();
      await expect(page.getByTestId('button-new-move')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId('button-new-move').click();
      await choose(page, 'Source location', 'Demo Main Warehouse');
      await page.getByTestId('checkbox-move-product-demo-dust').check();
      await page.getByTestId('input-move-qty-demo-dust').fill('2');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`move-stock-${theme}-${appearance}.png`), fullPage: true });
      await page.getByTestId('button-cancel-move').click();
      await expect(page.locator('[data-testid^="row-move-"]')).toHaveCount(1);
    });
  }
}
