import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') throw new Error('Stock Ledger requires the disposable authenticated harness.');
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/inventory/stock-status';
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser exceptions').toEqual([]));

async function open(page) {
  await authenticateAdmin(page);
  await page.goto(`${base()}${path}`);
  await expect(page.getByRole('heading', { name: 'Stock status', exact: true })).toBeVisible();
}
async function waitSnapshot(page, id) {
  await expect(page.getByTestId(`row-stock-${id}`)).toBeVisible();
  await expect(page.getByTestId('button-view-stock-' + id)).toBeEnabled();
}
async function modalGeometry(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page must not overflow').toBe(true);
  const dialog = page.getByRole('dialog').last();
  expect(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth + 1), 'Dialog must not overflow horizontally').toBe(true);
}
async function assertFocusTrap(page, dialog) {
  for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(n => n.contains(document.activeElement)), `${key} remains in dialog`).toBe(true);
  }
}

test('synthetic stock ledger and manual adjustment journey: review, lost acknowledgement, reconciliation and exact-lot correction', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const refs = await page.evaluate(async () => {
    const s = await import('/src/auth/adminSession.js');
    const tag = crypto.randomUUID().slice(0, 8);
    const location = await s.locationRequest('', { body: { name: `Ledger location ${tag}`, address: 'Synthetic test only', status: 'active' } });
    const category = await s.productCategoryRequest('', { body: { name: `Ledger category ${tag}`, description: '', unit_price: '0', status: 'active' } });
    const allergen = await s.allergenRequest('', { body: {
      name: `Ledger reagent ${tag}`, category_id: category.id, storage_location_id: location.id,
      selling_price: '0', gst: '0', concentration: 'synthetic', threshold_limit: null, mix: false, status: 'active',
    } });
    return { location, category, allergen };
  });
  const id = refs.allergen.id;
  await page.getByLabel('Search stock', { exact: true }).fill(refs.allergen.name);
  await waitSnapshot(page, id);
  const view = page.getByTestId(`button-view-stock-${id}`);
  const adjust = page.getByTestId(`button-adjust-stock-${id}`);
  await expect(view).toBeVisible(); await expect(adjust).toBeVisible();
  await adjust.click();
  let dialog = page.getByRole('dialog');
  await page.getByTestId('select-adjust-location').selectOption(refs.location.id);
  await page.getByTestId('input-adjust-quantity').fill('12.345');
  await page.getByTestId('input-adjust-reason').fill('Synthetic initial credit');
  await page.getByTestId('button-adjust-preview').click();
  const review = page.getByTestId('section-adjust-review');
  await expect(review).toContainText('0.000');
  await expect(review).toContainText('12.345');
  await page.screenshot({ path: test.info().outputPath('stock-ledger-desktop-review.png'), fullPage: true });

  // Only the acknowledgement is dropped: route.fetch sends the real POST to the
  // disposable server and its committed response is aborted before reaching UI.
  let committed;
  let routed;
  const routedOnce = new Promise(resolve => { routed = resolve; });
  const lostAck = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = await response.json();
      await route.abort();
      routed();
    } catch (error) { routed(); throw error; }
  };
  await page.route('**/api/v1/admin/inventory/adjustments', lostAck);
  await page.getByTestId('button-adjust-commit').click();
  await routedOnce;
  await page.unroute('**/api/v1/admin/inventory/adjustments', lostAck);
  expect(committed?.direction).toBe('add');
  await expect(page.getByTestId('status-adjust-done')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText('Save outcome is unconfirmed');
  await expect(page.getByTestId('button-adjust-check')).toBeVisible();
  await expect(page.getByTestId('button-adjust-retry')).toBeVisible();
  await expect(page.getByTestId('row-stock-' + id)).toContainText('0');
  await page.screenshot({ path: test.info().outputPath('stock-ledger-pending-ack.png'), fullPage: true });
  const journalBeforeReload = await page.evaluate(async () => {
    const s = await import('/src/auth/adminSession.js');
    const owner = s.getSession().user.id;
    return JSON.parse(localStorage.getItem(`evexia.adjust.pending:${owner}`));
  });
  expect(Object.keys(journalBeforeReload).sort()).toEqual(['key', 'owner']);
  expect(journalBeforeReload.key).toMatch(/^[0-9a-f-]{36}$/i);
  await page.reload();
  await waitSnapshot(page, id);
  await page.getByTestId(`button-adjust-stock-${id}`).click();
  await expect(page.getByTestId('status-adjust-pending')).toBeVisible();
  const journalAfterReload = await page.evaluate(async () => {
    const s = await import('/src/auth/adminSession.js');
    return JSON.parse(localStorage.getItem(`evexia.adjust.pending:${s.getSession().user.id}`));
  });
  expect(journalAfterReload).toEqual(journalBeforeReload);
  await page.screenshot({ path: test.info().outputPath('stock-ledger-pending-reloaded.png'), fullPage: true });
  await page.getByTestId('button-adjust-check').click();
  await expect(page.getByTestId('status-adjust-done')).toContainText('Added 12.345');
  await expect(page.getByTestId('status-adjust-done')).toContainText(committed.id);
  await expect.poll(async () => page.getByTestId('row-stock-' + id).innerText()).toContain('12.345');
  expect(await page.evaluate(async () => {
    const s = await import('/src/auth/adminSession.js');
    return localStorage.getItem(`evexia.adjust.pending:${s.getSession().user.id}`);
  })).toBeNull();
  await page.screenshot({ path: test.info().outputPath('stock-ledger-desktop-reconciled.png'), fullPage: true });
  await page.getByTestId('button-adjust-done').click();

  // Session refresh while a new draft is mounted must preserve its DOM state.
  await page.getByTestId(`button-adjust-stock-${id}`).click();
  await page.getByTestId('select-adjust-location').selectOption(refs.location.id);
  await page.getByTestId('input-adjust-quantity').fill('3.210');
  await page.getByTestId('input-adjust-reason').fill('Renewal draft stays mounted');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-adjust-quantity')).toHaveValue('3.210');
  await expect(page.getByTestId('input-adjust-reason')).toHaveValue('Renewal draft stays mounted');
  await page.getByTestId('button-adjust-cancel').click();

  // The ledger now contains a single credit; its summary is lifetime/as-of and
  // current on hand remains independent of transaction-type filtering.
  const ledger = page.getByTestId(`button-ledger-stock-${id}`);
  await ledger.click();
  dialog = page.getByRole('dialog');
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Additions\s*12\.345/);
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Current on hand\s*12\.345/);
  await expect(page.getByTestId('text-ledger-count')).toContainText('of 1');
  const creditRow = page.locator('[data-testid^="row-ledger-"]').filter({ hasText: 'Synthetic initial credit' });
  await expect(creditRow).toBeVisible();
  const firstSource = creditRow.locator('[data-testid^="button-ledger-source-"]');
  await firstSource.click();
  const source = page.getByRole('dialog').last();
  await expect(source).toContainText('Add 12.345');
  await expect(source).toContainText('Synthetic initial credit');
  await page.keyboard.press('Escape');
  await expect(firstSource).toBeFocused();

  const summaryBeforeFilter = await page.getByTestId('section-ledger-summary').innerText();
  await page.getByTestId('select-ledger-type').selectOption('opening');
  await expect(page.getByText('No ledger entries match')).toBeVisible();
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Current on hand\s*12\.345/);
  await page.getByTestId('select-ledger-type').selectOption('');
  await expect(page.getByTestId('text-ledger-count')).toContainText('of 1');
  await page.getByTestId('select-ledger-location').selectOption(refs.location.id);
  await expect(page.getByTestId('text-ledger-count')).toContainText('of 1');
  const today = new Date(committed.createdAt).toISOString().slice(0, 10);
  await page.getByTestId('input-ledger-from').fill(today);
  await page.getByTestId('input-ledger-to').fill(today);
  await expect(page.getByTestId('text-ledger-count')).toContainText('of 1');
  expect(summaryBeforeFilter).toContain('Current on hand');
  await page.getByTestId('input-ledger-from').fill('2099-01-01');
  await page.getByTestId('input-ledger-to').fill('2099-01-01');
  await expect(page.getByText('No ledger entries match')).toBeVisible();
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Current on hand\s*12\.345/);
  await page.getByTestId('input-ledger-from').fill('');
  await page.getByTestId('input-ledger-to').fill('');
  await page.getByTestId('select-ledger-location').selectOption('');

  // The second transaction is a compensating reduction of the exact credited lot.
  await page.keyboard.press('Escape');
  await expect(ledger).toBeFocused();

  // Reduce from this allergen's exact available lot, not an aggregate balance.
  await page.getByTestId(`button-adjust-stock-${id}`).click();
  await page.getByTestId('radio-adjust-reduce').check();
  const lotSelect = page.getByTestId('select-adjust-lot');
  await expect(lotSelect.locator('option')).toHaveCount(2);
  const exactLotOption = lotSelect.locator('option').nth(1);
  await expect(exactLotOption).toContainText('available 12.345');
  const exactLotValue = await exactLotOption.getAttribute('value');
  expect(exactLotValue).toMatch(/^[0-9a-f-]{36}\|[0-9a-f-]{36}$/i);
  const exactLotId = exactLotValue.split('|')[0];
  await expect(exactLotOption).toContainText(exactLotId);
  await lotSelect.selectOption(exactLotValue);
  await expect(lotSelect).toHaveValue(exactLotValue);
  await page.getByTestId('input-adjust-quantity').fill('12.346');
  await page.getByTestId('input-adjust-reason').fill('Synthetic over-available rejection');
  await page.getByTestId('input-adjust-correction').fill(committed.id);
  await page.getByTestId('button-adjust-preview').click();
  await expect(page.getByText('Quantity exceeds available 12.345.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('input-adjust-quantity')).toHaveValue('12.346');
  await page.getByTestId('input-adjust-quantity').fill('2.345');
  await page.getByTestId('input-adjust-reason').fill('Synthetic compensating reduction');
  await page.getByTestId('button-adjust-preview').click();
  await expect(page.getByTestId('section-adjust-review')).toContainText('12.345');
  await expect(page.getByTestId('section-adjust-review')).toContainText('-2.345');
  await expect(page.getByTestId('section-adjust-review')).toContainText('10.000');
  await page.setViewportSize({ width: 390, height: 844 });
  await modalGeometry(page);
  await assertFocusTrap(page, page.getByRole('dialog'));
  await page.screenshot({ path: test.info().outputPath('stock-ledger-mobile-review.png'), fullPage: true });
  await page.getByTestId('button-adjust-commit').click();
  await expect(page.getByTestId('status-adjust-done')).toContainText('Reduced 2.345');
  const reductionNotice = await page.getByTestId('status-adjust-done').innerText();
  const reductionId = reductionNotice.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  expect(reductionId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId('button-adjust-done').click();
  await expect.poll(async () => page.getByTestId('row-stock-' + id).innerText()).toContain('10.000');

  await page.getByTestId(`button-view-stock-${id}`).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('On hand 10.000');
  await modalGeometry(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`button-view-stock-${id}`)).toBeFocused();

  // A second, synthetic compensating reduction supplies a third real ledger
  // event so the supported two-row page size can exercise a server offset.
  await page.getByTestId(`button-adjust-stock-${id}`).click();
  await page.getByTestId('radio-adjust-reduce').check();
  const secondLotSelect = page.getByTestId('select-adjust-lot');
  await expect(secondLotSelect.locator('option').nth(1)).toContainText('available 10.000');
  await secondLotSelect.selectOption(exactLotValue);
  await page.getByTestId('input-adjust-quantity').fill('1.000');
  await page.getByTestId('input-adjust-reason').fill('Synthetic pagination entry');
  await page.getByTestId('input-adjust-correction').fill(reductionId);
  await page.getByTestId('button-adjust-preview').click();
  await expect(page.getByTestId('section-adjust-review')).toContainText('Before10.000');
  await expect(page.getByTestId('section-adjust-review')).toContainText('-1.000');
  await expect(page.getByTestId('section-adjust-review')).toContainText('9.000');
  await modalGeometry(page);
  await page.getByTestId('button-adjust-commit').click();
  await expect(page.getByTestId('status-adjust-done')).toContainText('Reduced 1.000');
  const paginationNotice = await page.getByTestId('status-adjust-done').innerText();
  const paginationId = paginationNotice.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  expect(paginationId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId('button-adjust-done').click();
  await expect.poll(async () => page.getByTestId('row-stock-' + id).innerText()).toContain('9.000');
  await page.screenshot({ path: test.info().outputPath('stock-ledger-mobile-adjusted.png'), fullPage: true });

  await page.getByTestId(`button-ledger-stock-${id}`).click();
  dialog = page.getByRole('dialog');
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Additions\s*12\.345/);
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Reductions\s*3\.345/);
  await expect(page.getByTestId('section-ledger-summary')).toContainText(/Current on hand\s*9\.000/);
  await expect(page.getByTestId('text-ledger-count')).toContainText('of 3');
  const creditRowAfterReduction = page.locator('[data-testid^="row-ledger-"]').filter({ hasText: 'Synthetic initial credit' });
  await expect(creditRowAfterReduction).toBeVisible();
  await page.getByLabel('Rows per page').last().selectOption('2');
  await expect(page.getByTestId('text-ledger-count')).toContainText('Showing 1–2 of 3');
  const reductionRow = page.locator('[data-testid^="row-ledger-"]').filter({ hasText: 'Synthetic compensating reduction' });
  await expect(reductionRow).toContainText(committed.id);
  await expect(reductionRow).toContainText(`Adjustment ${reductionId.slice(0, 8)}`);
  const reductionSource = reductionRow.locator('[data-testid^="button-ledger-source-"]');
  await reductionSource.click();
  const reductionDetail = page.getByRole('dialog').last();
  await expect(reductionDetail).toContainText('Reduce 2.345');
  await expect(reductionDetail).toContainText(`Reference ${reductionId}`);
  await expect(reductionDetail).toContainText(`Correction of ${committed.id}`);
  await modalGeometry(page);
  await assertFocusTrap(page, reductionDetail);
  await page.screenshot({ path: test.info().outputPath('stock-ledger-mobile-source.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(reductionSource).toBeFocused();
  const pageTwoRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname.endsWith(`/stock/${id}/ledger`) && url.searchParams.get('offset') === '2';
  });
  await page.getByRole('navigation', { name: 'entries pages' }).getByRole('button', { name: 'Next page', exact: true }).click();
  expect((await pageTwoRequest).url()).toContain('limit=2');
  await expect(page.getByTestId('text-ledger-count')).toContainText('Showing 3–3 of 3');
  const pageThreeRow = page.locator('[data-testid^="row-ledger-"]').filter({ hasText: 'Synthetic pagination entry' });
  await expect(pageThreeRow).toContainText(reductionId);
  await expect(pageThreeRow).toContainText(`Adjustment ${paginationId.slice(0, 8)}`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`button-ledger-stock-${id}`)).toBeFocused();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true);
  await page.screenshot({ path: test.info().outputPath('stock-ledger-mobile-final.png'), fullPage: true });
});
