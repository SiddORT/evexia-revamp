import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const forms = [
  { name: 'lupin', path: 'lupin', root: '.lupin', heading: '.lupin-section h2', field: '.lupin-field', save: 'button-lupin-save' },
  { name: 'kits', path: 'kits-consumables', root: '.kits', heading: '.kits-panel h2', field: '.kits-field', save: 'kits-save' },
  { name: 'spt', path: 'spt', root: '.spt', heading: '.spt-card h2', field: '.spt-field', save: 'button-spt-save' },
];
async function login(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}
async function fit(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize()).width + 1);
}
async function choose(page, label) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill('Mira');
  await input.press('ArrowDown');
  await input.press('Enter');
  await input.press('Tab');
}

test('order entry visual evidence and scoped baseline', async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const form of forms) {
    await page.goto(`${base()}/admin/orders/${form.path}/new`);
    await expect(page.locator(`${form.root} h1`)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${process.env.EVEXIA_ORDER_ENTRY_BEFORE ? 'before' : 'after'}-${form.name}.png`), fullPage: true });
    if (process.env.EVEXIA_ORDER_ENTRY_BEFORE) continue;
    await expect(page.locator(form.heading).first()).toHaveCSS('font-size', '16px');
    await expect(page.locator(form.heading).first()).toHaveCSS('font-weight', '500');
    await expect(page.locator(`${form.field} > label`).first()).toHaveCSS('font-size', '11px');
    await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveCSS('font-size', '13px');
    const rect = await page.getByRole('combobox', { name: 'Doctor', exact: true }).boundingBox();
    expect(rect.height).toBeGreaterThanOrEqual(38);
    expect(rect.height).toBeLessThanOrEqual(42);
  }
});

test('order entry themes, conditional content, keyboard menus and real doubled text', async ({ page }, info) => {
  test.skip(Boolean(process.env.EVEXIA_ORDER_ENTRY_BEFORE));
  test.setTimeout(180000);
  const domainRequests = [];
  page.on('request', (r) => { if (/\/api\/.*(?:doctors|mrs|patients|orders|upload|export|kits|consumables)/i.test(r.url())) domainRequests.push(r.url()); });
  await login(page);
  for (const form of forms) for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base()}/admin/orders/${form.path}/new`);
      await expect(page.locator(`${form.root} h1`)).toBeVisible();
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      await page.evaluate(() => {
        window.orderEntryWrites = [];
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { window.orderEntryWrites.push(key); return original.call(this, key, value); };
      });
      await page.getByTestId(form.save).click();
      await fit(page);
      if (form.name === 'kits') {
        await page.getByTestId('kits-input-kit-product').selectOption('Customized');
        await page.getByTestId('kits-ship-other').check();
        await expect(page.getByTestId('kits-input-kit-custom')).toBeVisible();
        await expect(page.getByTestId('kits-other-form')).toBeVisible();
      }
      if (form.name === 'spt') {
        await page.getByTestId('button-spt-register').click();
        await page.locator('#spt-reg-name').fill('Long fictional patient name '.repeat(3));
        await page.locator('#spt-reg-gender').selectOption('Female');
        await page.locator('#spt-reg-age').fill('35');
        await page.getByTestId('button-spt-register-submit').click();
        await page.getByTestId('button-spt-add-patient').click();
        await page.locator('.spt-amount').fill('100');
        await expect(page.getByTestId('text-spt-total')).toContainText('100.00');
        await page.getByTestId('button-spt-register').click();
        await expect(page.getByTestId('form-spt-register')).toBeVisible();
      } else {
        const picker = page.getByTestId(form.name === 'kits' ? 'kits-input-files' : 'input-lupin-files');
        await picker.setInputFiles({ name: `${'long-filename-'.repeat(16)}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('demo metadata') });
      }
      await choose(page, 'Doctor');
      const doctor = page.getByRole('combobox', { name: 'Doctor', exact: true });
      await doctor.scrollIntoViewIfNeeded();
      await doctor.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(doctor).toBeFocused();
      await doctor.press('ArrowDown');
      const menu = page.getByRole('listbox', { name: 'Doctor', exact: true });
      await expect(menu).toBeVisible();
      const r = await menu.boundingBox();
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(width + 1);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(1001);
      expect(await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(15, r.height / 2)));
      })).toBe(true);
      await doctor.press('Escape');
      await expect(menu).toHaveCount(0);
      await fit(page);
      // Snapshot first: mutating parents while reading children can multiply
      // inherited sizes twice rather than produce actual 200% text.
      const samples = await page.evaluate((root) => {
        const els = [...document.querySelectorAll(`${root}, ${root} *`)];
        const sizes = els.map((el) => parseFloat(getComputedStyle(el).fontSize));
        els.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 2}px`; });
        return els.map((el, i) => parseFloat(getComputedStyle(el).fontSize) / sizes[i]);
      }, form.root);
      expect(samples.every((ratio) => Math.abs(ratio - 2) < 0.01)).toBe(true);
      await fit(page);
      if (form.name === 'spt' && width === 360) {
        const table = page.getByRole('region', { name: 'Selected patients', exact: true });
        // Long names must wrap into readable lines, not a character-wide
        // column that turns a selected patient into a full-height row.
        const row = await table.locator('tbody tr').boundingBox();
        expect(row.height).toBeLessThan(250);
        await table.focus();
        await expect(table).toBeFocused();
        expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await page.keyboard.press('ArrowRight');
      }
      // Recheck placement after enlarged text, with the anchor near an edge.
      await doctor.evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
        window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 100);
      });
      await doctor.click();
      await expect(menu).toBeVisible();
      const doubledMenu = await menu.boundingBox();
      expect(doubledMenu.y).toBeGreaterThanOrEqual(0);
      expect(doubledMenu.y + doubledMenu.height).toBeLessThanOrEqual(1001);
      await doctor.press('Escape');
      expect(await page.locator(`${form.root} .admin-button`).evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1))).toBe(true);
      const writes = await page.evaluate(() => window.orderEntryWrites);
      expect(writes.filter((key) => /lupin|kits|spt|order/i.test(key))).toEqual([]);
      if (width === 360) await page.screenshot({ path: info.outputPath(`${form.name}-${theme}-${appearance}-200pct.png`), fullPage: true });
    }
  }
  expect(domainRequests).toEqual([]);
});
