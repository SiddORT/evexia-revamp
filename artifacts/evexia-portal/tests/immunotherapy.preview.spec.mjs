import { test, expect } from '@playwright/test';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const route = '/admin/orders/immunotherapy';
async function choose(page, label, query) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(query); await input.press('ArrowDown'); await input.press('Enter'); await input.press('Tab');
}
async function login(page, path = route) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}${path}`);
  await expect(page.locator('.imm h1')).toBeVisible();
}
async function overflow(page, label = 'layout', collect = false) {
  const state = await page.evaluate(() => {
    const width = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > innerWidth + 1 && !el.closest('.admin-table-scroll');
    }).slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      const selector = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.classList?.length ? `.${[...node.classList].join('.')}` : ''}`;
      const path = [];
      for (let node = el; node && node !== document.body && path.length < 4; node = node.parentElement) path.unshift(selector(node));
      return `${path.join(' > ')} left=${Math.round(r.left)} right=${Math.round(r.right)} width=${Math.round(r.width)}`;
    });
    return { width, viewport: innerWidth, offenders };
  });
  if (state.width > state.viewport + 1) {
    const screenshot = test.info().outputPath(`overflow-${label}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    state.screenshot = screenshot;
    if (!collect) throw new Error(`Horizontal overflow ${state.width}px > viewport ${state.viewport}px; offenders: ${state.offenders.join('; ')}. Screenshot: ${screenshot}`);
    return state;
  }
  return null;
}
async function enlargeText(page) {
  return await page.evaluate(() => {
    const samples = ['.imm h1', '.imm-section h2', '.imm-field'].map((selector) => {
      const el = document.querySelector(selector);
      return el ? [selector, parseFloat(getComputedStyle(el).fontSize)] : null;
    }).filter(Boolean);
    const sizes = [...document.querySelectorAll('.admin-shell *')].map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
    for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`;
    return samples.map(([selector, before]) => [selector, before, parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)]);
  });
}

test('patient-first order, grouping, exact MRP, metadata, guard, edit and reload boundary', async ({ page }) => {
  test.setTimeout(120000);
  const calls = [], faults = [];
  page.on('request', (r) => { if (/\/api\/.*(?:patients|doctors|mrs|allergens|orders)/.test(r.url())) calls.push(r.url()); });
  page.on('pageerror', (e) => faults.push(e.message));
  await login(page, `${route}/new`);
  await page.screenshot({ path: test.info().outputPath('immunotherapy-editor.png'), fullPage: true });
  await page.evaluate(() => {
    window.__immWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { window.__immWrites.push(key); return original.call(this, key, value); };
  });
  await page.getByTestId('button-imm-save').click();
  await expect(page.getByTestId('error-imm-summary')).toBeFocused();
  await choose(page, 'Patient', 'Asha');
  await expect(page.getByTestId('radio-imm-dose-DD')).toBeChecked();
  await choose(page, 'Patient', 'Rohan');
  await expect(page.getByTestId('radio-imm-dose-B1')).toBeChecked();
  await choose(page, 'Patient', 'Kiran');
  await expect(page.locator('input[name="dosage"]:checked')).toHaveCount(0);
  await choose(page, 'Patient', 'Neel');
  await expect(page.locator('input[name="dosage"]:checked')).toHaveCount(0);
  await expect(page.getByTestId('text-imm-dose-explain')).toContainText('B8');
  await choose(page, 'Patient', 'Asha');
  await page.getByTestId('radio-imm-dose-B3').check();
  await page.getByTestId('input-imm-histamine').fill('5');
  await page.getByTestId('input-imm-saline').fill('0');
  await choose(page, 'Allergen', 'Grass');
  await choose(page, 'Allergen', 'Mite');
  await expect(page.getByTestId('imm-bottle-0')).toContainText('must be alone');
  await choose(page, 'Allergen', 'Pollen');
  await page.getByTestId('imm-bottle-0').getByLabel('Result (mm)').nth(0).fill('3');
  await page.getByTestId('imm-bottle-0').getByLabel('Result (mm)').nth(1).fill('4');
  await page.getByTestId('input-imm-mrp-0').fill('0.10');
  await page.getByTestId('button-imm-add-bottle').click();
  const picker = page.getByTestId('imm-bottle-1').getByRole('combobox', { name: 'Allergen', exact: true });
  await picker.fill('Mite'); await picker.press('ArrowDown'); await picker.press('Enter'); await picker.press('Tab');
  await page.getByTestId('imm-bottle-1').getByLabel('Result (mm)').fill('2');
  await page.getByTestId('input-imm-mrp-1').fill('0.20');
  await expect(page.getByTestId('text-imm-total')).toHaveText('₹0.30');
  await page.getByTestId('input-imm-files').setInputFiles({ name: 'fictional.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 example') });
  await page.getByTestId('input-imm-remarks').fill('Keep this draft');
  await page.getByTestId('button-imm-cancel').click();
  await expect(page.getByTestId('dialog-imm-leave')).toBeVisible();
  await page.getByTestId('button-imm-stay').click();
  await expect(page.getByTestId('input-imm-remarks')).toHaveValue('Keep this draft');
  await page.getByTestId('button-imm-save').click();
  await expect(page.getByTestId('status-imm-notice')).toContainText('saved');
  await page.getByTestId('link-imm-edit-demo-it-19').click();
  await expect(page.getByTestId('radio-imm-dose-B3')).toBeChecked();
  await expect(page.getByTestId('text-imm-total')).toHaveText('₹0.30');
  await expect(page.getByText('fictional.pdf', { exact: false })).toBeVisible();
  await page.getByTestId('select-imm-order-status').selectOption('In process');
  await page.getByTestId('button-imm-save').click();
  await expect(page.getByTestId('row-imm-demo-it-19')).toContainText('In process');
  await page.screenshot({ path: test.info().outputPath('immunotherapy-list.png'), fullPage: true });
  expect(calls).toEqual([]); expect(faults).toEqual([]);
  expect(await page.evaluate(() => window.__immWrites)).toEqual([]);
  await page.reload();
  await login(page, route);
  await expect(page.getByTestId('row-imm-demo-it-19')).toHaveCount(0);
  await page.goto(`${base()}${route}/unavailable`);
  await expect(page.getByTestId('empty-imm-missing')).toBeVisible();
});

test('composite listing, safe selection, all four printable references and scoped styles', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await expect(page.getByTestId('text-imm-count')).toContainText('1–5 of 18');
  await page.getByLabel('Rows per page', { exact: true }).selectOption('2');
  await expect(page.getByTestId('button-imm-first')).toBeDisabled();
  await expect(page.getByTestId('text-imm-count')).toContainText('1–2 of 18');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-imm-count')).toContainText('3–4');
  await page.getByTestId('button-imm-last').click();
  await expect(page.getByTestId('text-imm-count')).toContainText('17–18 of 18');
  await page.getByTestId('button-imm-first').click();
  await page.getByTestId('input-imm-search').fill('DEMO-IT-0001');
  await expect(page.getByTestId('text-imm-count')).toContainText('1–1 of 1');
  await page.getByTestId('select-imm-status').selectOption('In process');
  await expect(page.getByTestId('empty-imm')).toBeVisible();
  await page.getByTestId('button-imm-reset').click();
  await page.getByTestId('select-imm-status').selectOption('In process');
  await page.getByTestId('check-imm-page').check();
  await expect(page.getByTestId('text-imm-selection')).toContainText('2 selected');
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  for (const kind of ['bottle', 'newbox', 'oldbox', 'shipping']) {
    await page.getByTestId('button-imm-bulk-print').click();
    await page.getByTestId(`menu-imm-print-${kind}`).click();
    await expect(page.getByTestId('dialog-imm-print')).toContainText('2 In process orders');
    await expect(page.getByTestId('imm-print-labels')).toContainText('Demo');
    if (kind === 'bottle') {
      await expect(page.getByTestId('imm-print-labels')).toContainText('Suborder IT-SEED-14-A');
      await page.screenshot({ path: test.info().outputPath('immunotherapy-print.png'), fullPage: true });
    }
    if (kind === 'shipping') await expect(page.getByTestId('imm-print-labels')).toContainText('Dr. Arun Fiction');
    await page.getByTestId('button-imm-print-now').click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.admin-sidebar')).not.toBeVisible();
    await expect(page.getByTestId('imm-print-labels')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await page.getByTestId('button-imm-print-close').click();
  }
  expect(await page.evaluate(() => window.__printed)).toBe(4);
  await page.getByTestId('input-imm-search').fill('does not match');
  await expect(page.getByTestId('text-imm-selection')).toContainText('0 selected');
  await page.getByTestId('button-imm-reset').click();
  for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await overflow(page); }
  await page.goto(`${base()}/admin/orders/spt`);
  await expect(page.getByTestId('status-spt-demo')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.spt h1')).toBeVisible();
  expect(await page.locator('body').getAttribute('class') || '').not.toContain('imm-printing');
});

test('registration validates phone and manual address, then patient switching refreshes dose and recipient', async ({ page }) => {
  test.setTimeout(90000);
  await login(page, `${route}/new`);
  await page.getByTestId('button-imm-register').click();
  await page.getByTestId('button-imm-reg-save').click();
  await expect(page.getByTestId('input-imm-reg-name')).toBeFocused();
  await page.getByTestId('input-imm-reg-name').fill('Juniper Demo');
  await page.getByTestId('input-imm-reg-age').fill('36');
  await page.getByTestId('select-imm-reg-gender').selectOption('Other');
  await page.getByTestId('input-imm-reg-phone').fill('123');
  await page.getByTestId('button-imm-reg-save').click();
  await expect(page.locator('#imm-reg-phone-err')).toContainText('at least five digits');
  await expect(page.getByTestId('input-imm-reg-phone')).toBeFocused();
  await page.getByTestId('input-imm-reg-phone').fill('5550104321');
  await page.getByTestId('button-imm-reg-save').click();
  await expect(page.getByTestId('input-imm-reg-line1')).toBeFocused();
  await expect(page.getByTestId('form-imm-register')).toContainText('no live PIN lookup');
  for (const [field, value] of [
    ['line1', '88 Synthetic Road'], ['line2', 'Unit 4'], ['landmark', 'Near Example Park'],
    ['pincode', '123456'], ['city', 'Demo Harbor'], ['state', 'Sample State'], ['country', 'India'],
  ]) await page.getByTestId(`input-imm-reg-${field}`).fill(value);
  await page.getByTestId('select-imm-reg-doctor').selectOption('IT-DR-2');
  await page.getByTestId('select-imm-reg-mr').selectOption('IT-MR-3');
  await page.getByTestId('button-imm-reg-save').click();
  await expect(page.getByTestId('imm-patient-facts')).toContainText('Juniper Demo');
  await expect(page.getByTestId('imm-patient-facts')).toContainText('Demo Harbor');
  await expect(page.getByTestId('text-imm-dose-explain')).toContainText('no administration history');
  await expect(page.getByTestId('text-imm-recipient')).toContainText('88 Synthetic Road');
  await page.getByTestId('radio-imm-ship-doctor').check();
  await expect(page.getByTestId('text-imm-recipient')).toContainText('Dr. Arun Fiction');
  const doctorRecipient = await page.getByTestId('text-imm-recipient').innerText();
  await choose(page, 'Patient', 'Rohan');
  await expect(page.getByTestId('radio-imm-dose-B1')).toBeChecked();
  await expect(page.getByTestId('radio-imm-ship-patient')).toBeChecked();
  await expect(page.getByTestId('text-imm-recipient')).toContainText('Rohan Fiction');
  expect(await page.getByTestId('text-imm-recipient').innerText()).not.toBe(doctorRecipient);
});

test('duplicate allergens are blocked; valid and invalid bottle moves are explicit', async ({ page }) => {
  test.setTimeout(90000);
  await login(page, `${route}/new`);
  await choose(page, 'Patient', 'Asha');
  await page.getByTestId('radio-imm-dose-DD').check();
  await page.getByTestId('input-imm-histamine').fill('5');
  await page.getByTestId('input-imm-saline').fill('0');
  await choose(page, 'Allergen', 'Grass');
  await choose(page, 'Allergen', 'Pollen');
  await choose(page, 'Allergen', 'Pollen');
  await expect(page.getByTestId('imm-bottle-0')).toContainText('Duplicate allergens');
  await page.getByTestId('button-imm-add-bottle').click();
  await page.getByTestId('button-imm-add-bottle').click();
  await page.getByTestId('imm-bottle-1').getByRole('combobox', { name: 'Allergen', exact: true }).fill('Mite');
  await page.getByTestId('imm-bottle-1').getByRole('combobox', { name: 'Allergen', exact: true }).press('ArrowDown');
  await page.getByTestId('imm-bottle-1').getByRole('combobox', { name: 'Allergen', exact: true }).press('Enter');
  await page.getByTestId('imm-bottle-1').getByRole('combobox', { name: 'Allergen', exact: true }).press('Tab');
  await page.getByTestId('imm-bottle-0').getByLabel('Move Example Grass A to another bottle').selectOption({ index: 2 });
  await expect(page.getByTestId('imm-bottle-0')).not.toContainText('Example Grass A');
  await expect(page.getByTestId('imm-bottle-2')).toContainText('Example Grass A');
  await page.getByTestId('imm-bottle-0').getByLabel('Move Fictional Pollen B to another bottle').selectOption({ index: 1 });
  await expect(page.getByTestId('imm-bottle-1')).toContainText('No Mix allergens must be alone');

  // Verify the shared sidebar guard preserves the mounted draft when the user
  // chooses Keep editing, then check that cancelling inline registration does
  // not reset the selected patient, dosage, bottle composition, or remarks.
  await page.getByTestId('input-imm-remarks').fill('Retain pending move draft');
  await page.getByTestId('button-toggle-inventory').click();
  await page.getByTestId('link-admin-stock-status').click();
  await expect(page.getByTestId('dialog-imm-leave')).toBeVisible();
  await page.getByTestId('button-imm-stay').click();
  await expect(page.getByTestId('input-imm-remarks')).toHaveValue('Retain pending move draft');
  await expect(page.getByTestId('radio-imm-dose-DD')).toBeChecked();
  await expect(page.getByTestId('imm-bottle-2')).toContainText('Example Grass A');
  await page.getByTestId('button-imm-register').click();
  await page.getByTestId('input-imm-reg-name').fill('Uncommitted patient draft');
  await page.getByTestId('button-imm-reg-cancel').click();
  await expect(page.getByTestId('form-imm-register')).toHaveCount(0);
  await expect(page.getByTestId('imm-patient-facts')).toContainText('Asha Example');
  await expect(page.getByTestId('input-imm-remarks')).toHaveValue('Retain pending move draft');
  await expect(page.getByTestId('imm-bottle-2')).toContainText('Example Grass A');
});

test('malformed MRP and attachment types are rejected with a focusable error summary', async ({ page }) => {
  test.setTimeout(90000);
  await login(page, `${route}/new`);
  await choose(page, 'Patient', 'Asha');
  await page.getByTestId('radio-imm-dose-DD').check();
  await page.getByTestId('input-imm-histamine').fill('5');
  await page.getByTestId('input-imm-saline').fill('0');
  await choose(page, 'Allergen', 'Grass');
  await page.getByTestId('imm-bottle-0').getByLabel('Result (mm)').fill('3');
  await page.getByTestId('input-imm-mrp-0').fill('1.234');
  const bad = { name: 'mismatch.txt', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') };
  await page.getByTestId('input-imm-files').setInputFiles(bad);
  await expect(page.locator('#imm-files-err')).toContainText('extension and type must agree');
  await page.getByTestId('button-imm-save').click();
  await expect(page.getByTestId('error-imm-summary')).toBeFocused();
  await expect(page.locator('[data-testid^="link-imm-error-mrp-"]').first()).toContainText('at most two decimal places');
  await page.locator('[data-testid^="link-imm-error-mrp-"]').first().click();
  await expect(page.getByTestId('input-imm-mrp-0')).toBeFocused();
});

test('cold view and direct edit are read-only/editable; Radix print keyboard and dialog focus return', async ({ page }) => {
  test.setTimeout(90000);
  await login(page, `${route}/demo-it-1`);
  await expect(page.getByRole('heading', { name: 'Order DEMO-IT-0001' })).toBeVisible();
  await expect(page.getByTestId('radio-imm-dose-PD')).toBeDisabled();
  await expect(page.getByTestId('button-imm-save')).toHaveCount(0);
  await page.goto(`${base()}${route}/demo-it-1/edit`);
  await expect(page.getByTestId('button-imm-save')).toBeVisible();
  await expect(page.getByTestId('radio-imm-dose-DD')).toBeEnabled();
  await page.goto(`${base()}${route}`);
  await page.getByTestId('check-imm-page').check();
  await expect(page.getByTestId('text-imm-selection')).toContainText('1 selected');
  const trigger = page.getByTestId('button-imm-bulk-print');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Bottle labels' })).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dialog-imm-print')).toBeVisible();
  await expect(page.getByTestId('dialog-imm-print')).toContainText('Bottle labels preview');
  expect(await page.getByTestId('dialog-imm-print').evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-imm-print')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('all feature surfaces retain themes and responsive layout at 200% text', async ({ page }) => {
  test.setTimeout(240000);
  await login(page);
  const overflows = [];
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base()}${route}`);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      const ratios = await enlargeText(page);
      expect(ratios.length).toBeGreaterThan(0);
      expect(ratios.every(([, before, after]) => Math.abs(after / before - 2) < 0.02)).toBe(true);
      const result = await overflow(page, `list-${theme}-${appearance}-${width}`, true);
      if (result) overflows.push({ surface: 'list', theme, appearance, width, ...result });
    }
  }
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base()}${route}/demo-it-1/edit`);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      const ratios = await enlargeText(page);
      expect(ratios.length).toBeGreaterThan(0);
      expect(ratios.every(([, before, after]) => Math.abs(after / before - 2) < 0.02)).toBe(true);
      const result = await overflow(page, `editor-${theme}-${appearance}-${width}`, true);
      if (result) overflows.push({ surface: 'editor', theme, appearance, width, ...result });
    }
  }
  expect(overflows, `200% text overflow cases: ${JSON.stringify(overflows)}`).toEqual([]);
});
