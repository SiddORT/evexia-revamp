import { test, expect } from '@playwright/test';
import { staffPathAllowed } from '../src/auth/capabilities.js';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const directoryLinks = [
  'zones', 'courier-partners', 'mrs', 'sales-targets', 'doctors', 'product-categories',
  'storage-locations', 'headquarters', 'allergens', 'vendors', 'patients', 'opening-balances',
];

async function directory(page) {
  // Use the existing SPA link so a full reload cannot interrupt auth renewal.
  await page.getByTestId('link-admin-masters').click();
  await expect(page.getByRole('heading', { name: 'Masters', exact: true })).toBeVisible();
}

async function tabTo(page, target) {
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(el => el === document.activeElement)) return;
  }
  throw new Error('Masters import action was not keyboard reachable');
}

test('Masters directory opens shared Zone import with mouse, Enter and Space; directory links remain intact', async ({ page }) => {
  await page.goto(`${base()}/admin/masters`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByRole('heading', { name: 'Masters', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import data', exact: true })).toHaveCount(1);
  await expect(page.locator('.admin-master-link')).toHaveCount(directoryLinks.length);
  for (const slug of directoryLinks) {
    await expect(page.getByTestId(`link-master-${slug}`)).toHaveAttribute('href', `/admin/masters/${slug}`);
  }
  for (const input of ['mouse', 'Enter', 'Space']) {
    const action = page.getByTestId('button-import-masters');
    if (input === 'mouse') await action.click();
    else {
      await tabTo(page, action);
      await expect(action).toBeFocused();
      await expect(action).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press(input);
    }
    await expect(page).toHaveURL(/\/admin\/masters\/import\/zone$/);
    const tabs = page.getByRole('navigation', { name: 'Select a master for import' });
    await expect(tabs.getByRole('button', { name: 'Zone Master', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(tabs.getByRole('button', { name: 'Doctor Master', exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'Doctor Master', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/masters\/import\/doctor$/);
    await expect(tabs.getByRole('button', { name: 'Doctor Master', exact: true })).toHaveAttribute('aria-current', 'page');
    await directory(page);
  }
  await page.getByTestId('link-master-zones').click();
  await expect(page).toHaveURL(/\/admin\/masters\/zones$/);
  await expect(page.getByRole('heading', { name: 'Zone Master', exact: true })).toBeVisible();
  await directory(page);
  await page.getByTestId('link-master-patients').click();
  await expect(page).toHaveURL(/\/admin\/masters\/patients$/);
  await expect(page.getByRole('heading', { name: 'Patient Master', exact: true })).toBeVisible();
});

test('Masters heading and import action fit desktop/mobile in both palettes and appearances', async ({ page }, info) => {
  await page.goto(`${base()}/admin/masters`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByRole('heading', { name: 'Masters', exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['classic', 'modern']) {
      for (const appearance of ['light', 'dark']) {
        await page.evaluate(async ({ theme, appearance }) => {
          const preferences = await import('/src/components/admin/adminPreferences.js');
          preferences.setAdminPreference('theme', theme);
          preferences.setAdminPreference('appearance', appearance);
        }, { theme, appearance });
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
        const bounds = await page.locator('.admin-page-head').evaluate(head => {
          const [heading, button] = [head.querySelector('h1'), head.querySelector('button')].map(el => el.getBoundingClientRect());
          const panel = head.nextElementSibling.getBoundingClientRect();
          return {
            fits: [head.getBoundingClientRect(), heading, button].every(rect => rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0),
            overlap: heading.left < button.right && heading.right > button.left && heading.top < button.bottom && heading.bottom > button.top,
            gap: panel.top - head.getBoundingClientRect().bottom,
            direction: getComputedStyle(head).flexDirection,
          };
        });
        expect(bounds.fits).toBe(true);
        expect(bounds.overlap).toBe(false);
        expect(bounds.gap).toBeGreaterThanOrEqual(16);
        expect(bounds.direction).toBe(width === 390 ? 'column' : 'row');
        await page.screenshot({ path: info.outputPath(`masters-${width}-${theme}-${appearance}.png`) });
      }
    }
  }
  // Main directory remains unavailable to staff, including import-enabled staff.
  expect(staffPathAllowed('/admin/masters', { identity_kind: 'staff', permissions: ['zone.import'] })).toBe(false);
  expect(staffPathAllowed('/admin/masters/import/zone', { identity_kind: 'staff', permissions: ['zone.import'] })).toBe(true);
  expect(staffPathAllowed('/admin/masters/import/zone', { identity_kind: 'staff', permissions: ['zone.export'] })).toBe(false);
});
