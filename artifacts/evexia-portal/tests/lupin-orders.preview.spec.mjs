import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const LIST = '/admin/orders/lupin';
const heading = (page) => page.getByRole('heading', { name: 'Order Management – Lupin', exact: true });
const file = (name = 'fictional.pdf', size = 128, mimeType = 'application/pdf') => ({ name, mimeType, buffer: Buffer.alloc(size, 1) });
async function login(page, path = LIST) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}${path}`);
  await expect(page.locator('.lupin h1')).toBeVisible();
}
async function choose(page, label, query) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(query);
  await input.press('ArrowDown');
  await input.press('Enter');
  await input.press('Tab');
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function tabTo(page, locator) {
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Control is not keyboard reachable');
}

test('Lupin exact validation, attachments, save, review, filters, CSV, cancel and reload reset', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const forbidden = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (req) => { if (/\/api\/.*(?:doctors|mrs|patients|orders|upload|export)/i.test(req.url())) forbidden.push(req.url()); });
  await login(page);
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(6);
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('link-admin-orders-lupin')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Price (per Test)', exact: true })).toHaveValue('1000');
  await expect(page.getByTestId('lupin-total')).toHaveValue('₹0.00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('lupin-errors')).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await choose(page, 'Doctor', 'Mira');
  await choose(page, 'MR', 'Dev');
  await page.getByRole('textbox', { name: 'Remarks', exact: true }).fill('Fictional note retained after errors.');
  const count = page.getByRole('textbox', { name: 'No. of Patients', exact: true });
  const price = page.getByRole('textbox', { name: 'Price (per Test)', exact: true });
  for (const bad of ['0', '-1', '1.5', '9007199254740992', '1e2', '']) {
    await count.fill(bad);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(count).toHaveAttribute('aria-invalid', 'true');
    await expect(count).toHaveValue(bad);
    await expect(page.getByTestId('lupin-total')).toHaveValue('₹0.00');
  }
  await count.fill('3');
  for (const bad of ['', '0', '-1', 'NaN', 'Infinity', '1e2', '0.001', '1.']) {
    await price.fill(bad);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(price).toHaveValue(bad);
    await expect(page.getByTestId('lupin-total')).toHaveValue('₹0.00');
  }
  await price.fill('0.10');
  await expect(page.getByTestId('lupin-total')).toHaveValue('₹0.30');
  const picker = page.getByTestId('input-lupin-files');
  await picker.setInputFiles(file('bad.txt', 128, 'text/plain'));
  await expect(page.locator('#lupin-files-err')).toContainText('PDF');
  await picker.setInputFiles(file('huge.pdf', 10485761));
  await expect(page.locator('#lupin-files-err')).toContainText('10 MB');
  await picker.setInputFiles(Array.from({ length: 11 }, (_, i) => file(`demo-${i}.pdf`)));
  await expect(page.locator('#lupin-files-err')).toContainText('ten');
  await picker.setInputFiles(Array.from({ length: 10 }, (_, i) => file(`demo-${i}.pdf`)));
  await expect(page.getByRole('list', { name: 'Selected files' }).locator('li')).toHaveCount(10);
  await picker.setInputFiles(file('eleventh.pdf'));
  await expect(page.locator('#lupin-files-err')).toContainText('ten');
  await page.getByRole('button', { name: 'Remove demo-0.pdf', exact: true }).click();
  await picker.setInputFiles(file());
  await expect(page.getByRole('list', { name: 'Selected files' }).locator('li')).toHaveCount(10);
  await expect(page.getByRole('textbox', { name: 'Remarks', exact: true })).toHaveValue('Fictional note retained after errors.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(heading(page)).toBeVisible();
  await expect(page.getByTestId('lupin-notice')).toContainText('session only');
  await expect(page.getByTestId('row-lupin-demo-lupin-7')).toContainText('₹0.30');
  await expect(page.getByTestId('row-lupin-demo-lupin-7')).toContainText('Confirmed');
  await expect(page.getByTestId('row-lupin-demo-lupin-7')).toContainText('Unpaid');
  await page.getByRole('link', { name: 'View DEMO-LUPIN-0007', exact: true }).click();
  await expect(page.getByTestId('text-lupin-review-total')).toHaveText('₹0.30');
  await expect(page.getByRole('list', { name: 'Attachment names' }).locator('li')).toHaveCount(10);
  await expect(page.getByText('Fictional note retained after errors.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /pay|download|save/i })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await page.getByLabel('Search', { exact: true }).fill('DEMO-LUPIN-0007');
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadEvent;
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('DEMO-LUPIN-0007');
  expect(csv).not.toContain('DEMO-LUPIN-0001');
  expect(csv).not.toContain('fictional.pdf');
  expect(csv).not.toContain('Fictional note retained');
  expect(csv).not.toContain('LP-DR-');
  await page.getByTestId('button-lupin-reset').click();
  await page.getByTestId('button-lupin-status').click();
  await page.getByRole('menuitemcheckbox', { name: 'Confirmed Orders', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Approved Orders', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove Confirmed Orders', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply Filter', exact: true }).click();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Approved Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Filter', exact: true }).click();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(2);
  await page.getByTestId('button-lupin-reset').click();
  await choose(page, 'Doctor', 'Mira');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-10');
  await page.getByRole('button', { name: 'Apply Filter', exact: true }).click();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(1);
  await page.getByLabel('Search', { exact: true }).fill('absent');
  await expect(page.getByTestId('empty-lupin')).toBeVisible();
  await page.getByTestId('button-lupin-reset').click();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(7);
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await count.fill('8');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(7);
  await page.screenshot({ path: testInfo.outputPath('lupin-list.png') });
  await page.reload();
  await expect(page.locator('[data-testid^="row-lupin-"]')).toHaveCount(6);
  await page.goto(`${base()}${LIST}/demo-lupin-7`);
  await expect(page.getByTestId('empty-lupin-missing')).toBeVisible();
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test('Lupin cold routes, responsive themes, enlarged text and viewport menus', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await login(page, `${LIST}/new`);
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base()}${LIST}/new`);
      await expect(page.getByRole('heading', { name: 'Add Lupin Order', exact: true })).toBeVisible();
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      await noOverflow(page);
      const doctor = page.getByRole('combobox', { name: 'Doctor', exact: true });
      await tabTo(page, doctor);
      await expect(doctor).toBeFocused();
      await doctor.press('ArrowDown');
      const options = page.getByRole('listbox', { name: 'Doctor', exact: true });
      await expect(options).toBeVisible();
      const rect = await options.boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(901);
      await expect(options.getByRole('option').last()).toBeInViewport();
      await page.keyboard.press('Enter');
      await expect(doctor).toHaveValue('Dr. Mira Example');
      await doctor.press('ArrowDown');
      await page.keyboard.press('Escape');
      await expect(options).toHaveCount(0);
      await doctor.press('ArrowDown');
      await page.keyboard.press('Tab');
      await expect(options).toHaveCount(0);
      await doctor.click();
      await page.getByRole('heading', { name: 'Order Details', exact: true }).click();
      await expect(options).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`lupin-form-${theme}-${appearance}-${width}.png`) });
      await page.goto(`${base()}${LIST}`);
      await expect(heading(page)).toBeVisible();
      const status = page.getByTestId('button-lupin-status');
      await tabTo(page, status);
      await page.keyboard.press('Enter');
      const last = page.getByRole('menuitemcheckbox', { name: 'Returned Orders', exact: true });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(status).toBeFocused();
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`${base()}${LIST}/new`);
  const before = await page.locator('#lupin-price').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.locator('.lupin').evaluate((root) => {
    const elements = [root, ...root.querySelectorAll('*')];
    const sizes = elements.map((el) => parseFloat(getComputedStyle(el).fontSize));
    elements.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 2}px`; });
  });
  expect(await page.locator('#lupin-price').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(before * 2);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('lupin-enlarged.png') });
});

test('Lupin direct add and review remain authenticated', async ({ page }) => {
  for (const path of [`${LIST}/new`, `${LIST}/demo-lupin-1`]) {
    await page.goto(`${base()}${path}`);
    await expect(page.getByTestId('button-submit-login')).toBeVisible();
    await expect(page.locator('.lupin')).toHaveCount(0);
  }
});

test('Lupin bottom-anchored selectors and status choices remain visible and clickable', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await login(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base()}${LIST}/new`);
    await expect(page.locator('.lupin')).toBeVisible();
    // Add space before the form to reproduce a control close to the viewport
    // bottom without changing the real card overflow or menu positioning.
    await page.locator('.lupin').evaluate((el) => { el.style.paddingTop = '900px'; });
    for (const [label, choice] of [['Doctor', 'Dr. Leela Sample'], ['MR', 'Noor Sample']]) {
      const control = page.getByRole('combobox', { name: label, exact: true });
      await control.evaluate((el) => el.scrollIntoView({ block: 'end' }));
      await control.click();
      const menu = page.getByRole('listbox', { name: label, exact: true });
      await expect(menu).toBeVisible();
      const fieldRect = await control.boundingBox();
      const menuRect = await menu.boundingBox();
      expect(fieldRect.y).toBeGreaterThan(650);
      expect(menuRect.y).toBeGreaterThanOrEqual(0);
      expect(menuRect.y + menuRect.height).toBeLessThanOrEqual(fieldRect.y + 1);
      await expect(menu.getByRole('option', { name: choice, exact: true })).toBeInViewport();
      await menu.getByRole('option', { name: choice, exact: true }).click();
      await control.press('Tab');
      await expect(control).toHaveValue(choice);
    }
    await page.goto(`${base()}${LIST}`);
    await expect(heading(page)).toBeVisible();
    await page.locator('.lupin').evaluate((el) => { el.style.paddingTop = '900px'; });
    const trigger = page.getByTestId('button-lupin-status');
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const fieldRect = await trigger.boundingBox();
    const menuRect = await menu.boundingBox();
    expect(fieldRect.y).toBeGreaterThan(650);
    expect(menuRect.y).toBeGreaterThanOrEqual(0);
    expect(menuRect.y + menuRect.height).toBeLessThanOrEqual(fieldRect.y + 1);
    const returned = page.getByRole('menuitemcheckbox', { name: 'Returned Orders', exact: true });
    await expect(returned).toBeInViewport();
    await returned.click();
    await expect(returned).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: testInfo.outputPath(`lupin-bottom-menu-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('End');
    // Radix roving focus schedules the End target after the key event.
    await expect(returned).toBeFocused();
    await page.keyboard.press('Space');
    await expect(returned).toHaveAttribute('aria-checked', 'false');
    await page.mouse.click(width - 8, 80);
    await expect(menu).toHaveCount(0);
    await noOverflow(page);
  }
});
