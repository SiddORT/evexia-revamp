import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const list = '/admin/orders/kits-consumables';
async function login(page, path = list) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}${path}`);
  await expect(page.locator('.kits h1')).toBeVisible();
}
async function choose(page, label, query) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(query);
  await input.press('ArrowDown');
  await input.press('Enter');
  await input.press('Tab');
}
async function fit(page) {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
}
async function csv(page) {
  const next = page.waitForEvent('download');
  await page.getByTestId('kits-export').click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  const download = await next;
  expect(download.suggestedFilename()).toBe('kits-consumables-orders.csv');
  return fs.readFile(await download.path(), 'utf8');
}

test('custom kit save/view, independent shipping and billing, optional attachments, cancel and reload boundary', async ({ page }, info) => {
  test.setTimeout(120000);
  const requests = []; const errors = [];
  page.on('request', (r) => { if (/\/api\/.*(?:doctors|mrs|patients|orders|upload|kits|consumables)/i.test(r.url())) requests.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  // Instrument writes after the shared shell is mounted, retaining its existing
  // navigation/activity preferences while rejecting feature-specific persistence.
  await page.evaluate(() => {
    window.kitsStorageWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { window.kitsStorageWrites.push(key); return original.call(this, key, value); };
  });
  await page.getByTestId('kits-add').click();
  await page.getByTestId('kits-save').click();
  await expect(page.getByTestId('kits-error-summary')).toContainText('Include at least one');
  await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await choose(page, 'Doctor', 'Mira');
  await expect(page.getByTestId('kits-billing-facts')).toContainText('101 Fictional Lane');
  await page.getByTestId('kits-ship-mr').check();
  await expect(page.getByTestId('kits-shipping-facts')).toContainText('Address unavailable');
  await expect(page.getByTestId('kits-shipping-facts')).not.toContainText('101 Fictional Lane');
  await expect(page.getByTestId('kits-billing-facts')).toContainText('101 Fictional Lane');
  await choose(page, 'MR', 'Riya');
  await expect(page.getByTestId('kits-shipping-facts')).toContainText('202 Fictional Lane');
  await page.getByRole('button', { name: 'Clear mr', exact: true }).click();
  await expect(page.getByTestId('kits-shipping-facts')).toContainText('Address unavailable');
  await page.getByTestId('kits-ship-other').check();
  for (const [key, value] of Object.entries({ name: 'Demo Receiver', phone: '+91 0000000999', line1: '500 Example Avenue', line2: 'Fictional Floor', landmark: 'Sample Tower', country: 'India', state: 'Sample State', city: 'Fiction City', pincode: '000000' })) {
    await page.getByTestId(`kits-input-other-${key}`).fill(value);
  }
  const options = await page.getByTestId('kits-input-kit-product').locator('option').allTextContents();
  expect(options.slice(1)).toEqual(['200', '250', '100', '85', '70', '58', 'Customized']);
  await page.getByTestId('kits-input-kit-product').selectOption('Customized');
  await page.getByTestId('kits-input-kit-volume').fill('-1');
  await page.getByTestId('kits-input-kit-quantity').fill('1.5');
  await page.getByTestId('kits-save').click();
  await expect(page.getByTestId('kits-error-summary')).toContainText('Custom value');
  await expect(page.getByTestId('kits-error-summary')).toContainText('positive whole');
  await page.getByTestId('kits-input-kit-custom').fill('150');
  await page.getByTestId('kits-input-kit-volume').fill('0.5');
  await page.getByTestId('kits-input-kit-quantity').fill('2');
  await page.getByTestId('kits-input-files').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('demo') });
  await expect(page.locator('#kits-attachments-err')).toContainText('Supported');
  await page.getByTestId('kits-save').click();
  await expect(page.getByTestId('kits-error-summary')).toContainText('rejected files');
  await expect(page).toHaveURL(new RegExp(`${list}/new$`));
  await page.getByTestId('kits-input-files').setInputFiles(Array.from({ length: 11 }, (_, i) => ({ name: `demo-${i}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('demo') })));
  await expect(page.locator('#kits-attachments-err')).toContainText('at most ten');
  await page.getByTestId('kits-input-files').setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator('#kits-attachments-err')).toContainText('10 MB');
  await page.getByTestId('kits-input-files').setInputFiles([
    { name: 'fictional.pdf', mimeType: 'application/pdf', buffer: Buffer.from('demo') },
    { name: 'example.png', mimeType: 'image/png', buffer: Buffer.from('demo') },
  ]);
  await expect(page.getByTestId('kits-file-list')).toContainText('fictional.pdf (1 KB)');
  await page.getByRole('button', { name: 'Remove example.png' }).click();
  await page.getByTestId('kits-input-remarks').fill('Fictional custom kit note');
  await page.getByTestId('kits-save').click();
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  await expect(page.getByTestId('kits-notice')).toContainText('session only');
  await expect(page.getByTestId('row-kits-demo-kit-7')).toContainText('Customized (150)');
  await expect(page.getByTestId('row-kits-demo-kit-7')).toContainText('Mock unpaid');
  await page.getByTestId('kits-view-demo-kit-7').click();
  await expect(page.getByTestId('kits-summary-items')).toContainText('Fictional custom kit note');
  await expect(page.getByTestId('kits-summary-shipping')).toContainText('Demo Receiver');
  await expect(page.getByTestId('kits-summary-billing')).toContainText('Dr. Mira Example');
  await expect(page.locator('.kits')).toContainText('fictional.pdf');
  await expect(page.getByTestId('kits-save')).toHaveCount(0);
  await fit(page);
  await page.screenshot({ path: info.outputPath('kits-summary.jpg'), fullPage: true });
  await page.getByTestId('kits-back').click();
  await page.getByTestId('kits-add').click();
  await page.getByTestId('kits-input-lancets').fill('999');
  await page.getByTestId('kits-cancel').click();
  await expect(page.getByTestId('kits-count')).toContainText('of 7 orders');
  const keys = await page.evaluate(() => window.kitsStorageWrites);
  expect(keys.filter((k) => /kits|consumables|order/i.test(k))).toEqual([]);
  await page.getByTestId('kits-view-demo-kit-7').click();
  await page.reload();
  await expect(page.getByTestId('kits-missing')).toContainText('resets');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('MR consumables-only order, required billing doctor, combined applied filters, reset and filtered private CSV', async ({ page }) => {
  await login(page, `${list}/new`);
  await page.getByTestId('kits-orderfor-mr').check();
  await choose(page, 'MR', 'Dev');
  await page.getByTestId('kits-ship-mr').check();
  await page.getByTestId('kits-input-lancets').fill('-5');
  await page.getByTestId('kits-save').click();
  await expect(page.getByTestId('kits-error-summary')).toContainText('billing');
  await expect(page.getByTestId('kits-error-summary')).toContainText('positive whole');
  await choose(page, 'Doctor', 'Arun');
  await page.getByTestId('kits-input-lancets').fill('12');
  await page.getByTestId('kits-input-applicators').fill('3');
  await page.getByTestId('kits-save').click();
  await expect(page.getByTestId('row-kits-demo-kit-7')).toContainText('Lancets: 12; Applicators: 3');
  await expect(page.getByTestId('row-kits-demo-kit-7')).not.toContainText('Stallergo');
  await page.getByTestId('kits-view-demo-kit-7').click();
  await expect(page.getByTestId('kits-summary-shipping')).toContainText('Dev Example');
  await expect(page.getByTestId('kits-summary-billing')).toContainText('Dr. Arun Fiction');
  await page.getByTestId('kits-back').click();
  await page.getByTestId('kits-filter-search').fill('DEMO-KIT-0007');
  await expect(page.getByTestId('kits-count')).toContainText('of 7 orders');
  await page.getByTestId('kits-apply').click();
  await expect(page.getByTestId('kits-count')).toContainText('of 1 orders');
  const data = await csv(page);
  expect(data.split('\r\n')).toHaveLength(2);
  expect(data).toContain('DEMO-KIT-0007');
  for (const forbidden of ['demo-kit-7', 'KIT-DR', 'KIT-MR', 'Fictional Lane', 'attachment', '0000000201']) expect(data).not.toContain(forbidden);
  await page.getByTestId('kits-reset').click();
  await expect(page.getByTestId('kits-filter-search')).toHaveValue('');
  await page.getByTestId('kits-filter-status-confirmed').check();
  await page.getByTestId('kits-filter-status-shipped').check();
  await page.getByTestId('kits-apply').click();
  await expect(page.getByTestId('kits-count')).toContainText('of 3 orders');
  await page.getByTestId('kits-filter-doctor').selectOption('KIT-DR-2');
  await page.getByTestId('kits-filter-payment').selectOption('Mock unpaid');
  await page.getByTestId('kits-apply').click();
  await expect(page.getByTestId('kits-count')).toContainText('of 1 orders');
  await page.getByTestId('kits-reset').click();
  await page.getByTestId('kits-filter-from').fill('2026-10-10');
  await page.getByTestId('kits-filter-to').fill('2026-10-10');
  await page.getByTestId('kits-apply').click();
  await expect(page.getByTestId('row-kits-demo-kit-1')).toBeVisible();
  await expect(page.getByTestId('kits-count')).toContainText('of 1 orders');
  await page.getByTestId('kits-filter-search').fill('not-found');
  await page.getByTestId('kits-apply').click();
  await expect(page.getByTestId('kits-empty')).toBeVisible();
  expect((await csv(page)).split('\r\n')).toHaveLength(1);
  await page.getByTestId('kits-reset').click();
  await expect(page.getByTestId('kits-count')).toContainText('of 7 orders');
});

test('cold routes and keyboard menus stay visible at desktop tablet mobile in each appearance', async ({ page }, info) => {
  test.setTimeout(180000);
  await login(page);
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base()}${list}`);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      await expect(page.getByTestId('kits-boundary')).toBeVisible();
      await fit(page);
      const region = page.getByRole('region', { name: 'Kits and consumables orders (scrolls horizontally)', exact: true });
      await expect(region).toHaveAttribute('tabindex', '0');
      if (width === 390) expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await page.goto(`${base()}${list}/new`);
      await expect(page.getByTestId('kits-save')).toBeVisible();
      await fit(page);
      const input = page.getByRole('combobox', { name: 'MR', exact: true });
      await input.focus();
      await input.fill('Riya');
      const menu = page.getByRole('listbox', { name: 'MR', exact: true });
      await expect(menu).toBeVisible();
      const geometry = await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 30));
        return { visible: el.contains(target), left: r.left, right: r.right, viewport: innerWidth, position: getComputedStyle(el).position };
      });
      expect(geometry.visible, JSON.stringify(geometry)).toBe(true);
      expect(geometry.position).toBe('fixed');
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      await input.press('ArrowDown'); await input.press('Enter'); await input.press('Tab');
      await expect(input).toHaveValue('Riya Fiction');
      await page.getByRole('combobox', { name: 'Doctor', exact: true }).fill('Mira');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`kits-form-${theme}-${appearance}-${width}.jpg`), fullPage: true });
    }
  }
});
