import { test, expect } from '@playwright/test';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const suffix = `${Date.now()}`;

async function loginAndSeed(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return page.evaluate(async (suffix) => {
    const vendorService = await import('/src/services/serverVendors.js');
    const locationService = await import('/src/services/serverLocations.js');
    const categoryService = await import('/src/services/serverProductCategories.js');
    const allergenService = await import('/src/services/serverAllergens.js');
    const vendor = await vendorService.createVendor({
      vendorName: `PO Smoke Vendor ${suffix}`, gstNo: '27DDDDD3333D1Z8',
      registeredAddress: 'Smoke Test Road', contactPersonName: 'Synthetic Contact',
      emailId: `po-${suffix}@example.test`, phoneNo: '9876543210', dialCountry: 'IN', status: 'active',
    });
    const location = await locationService.createLocation({ name: `PO Smoke Location ${suffix}`, address: 'Smoke Test Depot', status: 'active' });
    const category = await categoryService.createProductCategory({ name: `PO Smoke Category ${suffix}`, description: '', unit_price: '0.000000', status: 'active' });
    const create = (name, selling_price, gst) => allergenService.createAllergen({
      name, category_id: category.id, storage_location_id: location.id, selling_price, gst,
      concentration: 'Smoke test catalogue', threshold_limit: null, status: 'active', mix: false,
    });
    const priced = await create(`PO Smoke Product ${suffix}`, '123.456789', '18.123456');
    const alternate = await create(`PO Smoke Alternate ${suffix}`, '7.000001', '5.500001');
    const missing = await create(`PO Smoke No Price ${suffix}`, null, '0.000000');
    const zero = await create(`PO Smoke Zero ${suffix}`, '0.000000', '0.000000');
    return { vendor, location, category, priced, alternate, missing, zero };
  }, suffix);
}

async function choose(page, testId, name) {
  const control = page.getByTestId(testId);
  await control.click();
  const list = page.getByRole('listbox', { name: await control.getAttribute('aria-label'), exact: true });
  const option = list.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
}

test('authenticated server-backed PO create, listing, activity, analytics and long-form layout smoke', async ({ page }) => {
  test.setTimeout(300_000);
  const browserErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  const refs = await loginAndSeed(page);

  await page.goto(`${base()}/admin/inventory/purchase-orders/new`);
  await expect(page.getByRole('heading', { name: 'New purchase order' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('po-form-loaded.png'), fullPage: true });
  await choose(page, 'select-po-vendor', refs.vendor.vendorName);
  await choose(page, 'select-po-location', refs.location.name);
  await page.getByTestId('input-po-expected-date').fill('2028-12-31');
  await choose(page, 'select-po-product-0', refs.priced.name);
  const price = page.getByTestId('input-po-price-0');
  const gst = page.getByTestId('input-po-gst-0');
  await expect(price).toHaveValue('123.456789');
  await expect(price).toHaveAttribute('readonly', '');
  await expect(gst).toHaveValue('18.123456');
  await choose(page, 'select-po-product-0', refs.alternate.name);
  await expect(price).toHaveValue('7.000001');
  await expect(gst).toHaveValue('5.500001');
  await page.getByRole('button', { name: 'Clear product', exact: true }).click();
  await expect(price).toHaveValue('');
  await expect(gst).toHaveValue('');
  await choose(page, 'select-po-product-0', refs.priced.name);
  await page.getByTestId('input-po-quantity-0').fill('3.125');
  await choose(page, 'select-po-product-0', refs.missing.name);
  await expect(page.getByText('Catalogue price unavailable. This line cannot be created.')).toBeVisible();
  await expect(page.getByTestId('input-po-price-0')).toHaveValue('Unavailable');
  await choose(page, 'select-po-product-0', refs.zero.name);
  // Unit prices retain two display decimals while GST trims trailing zeros.
  await expect(page.getByTestId('input-po-price-0')).toHaveValue('0.00');
  await expect(page.getByTestId('input-po-gst-0')).toHaveValue('0');
  await choose(page, 'select-po-product-0', refs.priced.name);

  // Twelve repeated catalogue-backed lines exercise the long editor without broad regression coverage.
  for (let i = 1; i < 12; i++) {
    await page.getByTestId('button-add-po-line').click();
    await choose(page, `select-po-product-${i}`, refs.priced.name);
    await page.getByTestId(`input-po-quantity-${i}`).fill(i === 1 ? '1.250' : '1');
  }
  await expect(page.locator('.po-new-line')).toHaveCount(12);
  const totals = page.getByTestId('text-po-form-total');
  await expect(totals).toBeVisible();
  for (const [width, height, scrollTarget] of [
    [1440, 900, '.po-new-line:nth-child(7)'],
    [390, 844, '.po-new-line:nth-child(12)'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator(scrollTarget).scrollIntoViewIfNeeded();
    const layout = await page.evaluate((target) => {
      const sticky = document.querySelector('.po-new-layout .po-new-summary').getBoundingClientRect();
      const viewport = { width: innerWidth, height: innerHeight };
      // Measure the row the operator scrolled to, not an earlier partial row
      // passing behind the compact sticky header.
      const visibleLine = document.querySelector(target);
      const line = visibleLine?.getBoundingClientRect();
      const input = visibleLine?.querySelector('input')?.getBoundingClientRect();
      return { viewport, sticky: { top: sticky.top, bottom: sticky.bottom, left: sticky.left, right: sticky.right },
        line: line && { top: line.top, bottom: line.bottom, left: line.left, right: line.right },
        input: input && { top: input.top, bottom: input.bottom, left: input.left, right: input.right },
        scrollWidth: document.documentElement.scrollWidth };
    }, scrollTarget);
    expect(layout.sticky.top).toBeGreaterThanOrEqual(-1);
    expect(layout.sticky.bottom).toBeLessThanOrEqual(height + 1);
    expect(layout.sticky.left).toBeGreaterThanOrEqual(-1);
    expect(layout.sticky.right).toBeLessThanOrEqual(width + 1);
    expect(layout.line).toBeTruthy();
    expect(layout.input).toBeTruthy();
    expect(layout.sticky.bottom <= layout.line.top || layout.sticky.top >= layout.line.bottom ||
      layout.sticky.right <= layout.line.left || layout.sticky.left >= layout.line.right).toBe(true);
    expect(layout.scrollWidth).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: test.info().outputPath(`po-long-form-${width}.png`), fullPage: true });
  }
  // At mobile width, a product picker can still be opened/used near the bottom of the long form.
  await page.getByTestId('select-po-product-11').scrollIntoViewIfNeeded();
  await choose(page, 'select-po-product-11', refs.priced.name);
  await expect(page.getByTestId('input-po-quantity-11')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('input-po-expected-date').fill('2028-12-31');
  await page.getByTestId('button-review-po').scrollIntoViewIfNeeded();
  await page.getByTestId('button-review-po').click();
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible();
  await expect(page.getByText(`${refs.vendor.vendorName}`, { exact: true })).toBeVisible();
  await expect(page.getByText('12 product lines', { exact: true })).toBeVisible();
  const reviewedTotal = await page.getByTestId('text-po-form-total').innerText();
  await page.screenshot({ path: test.info().outputPath('po-review.png'), fullPage: true });
  const confirm = page.getByTestId('button-confirm-po');
  await confirm.dblclick();
  await expect(page).toHaveURL(/\/admin\/inventory\/purchase-orders$/);
  await expect(page.getByTestId('status-po-feedback')).toBeVisible();
  await expect(page.getByTestId('text-po-open-count')).toHaveText('1');
  await expect(page.getByTestId('text-po-open-value')).toHaveText(reviewedTotal);
  const savedOrderNumber = await page.locator('.po-table .po-number').first().innerText();
  const persisted = await page.evaluate(async () => {
    const { listPurchaseOrders } = await import('/src/services/serverPurchaseOrders.js');
    return listPurchaseOrders({ status: 'open', limit: 25, offset: 0 });
  });
  expect(persisted.filtered).toBe(1);
  expect(persisted.items[0].lines).toHaveLength(12);
  expect(persisted.items[0].lines[0]).toMatchObject({ unitPrice: '123.456789', gst: '18.123456' });
  await page.reload();
  await expect(page.getByTestId('text-po-open-count')).toHaveText('1');
  await expect(page.locator('.po-table .po-number').filter({ hasText: savedOrderNumber })).toBeVisible();

  const globalCardsBefore = await Promise.all([
    page.getByTestId('text-po-open-count').innerText(), page.getByTestId('text-po-open-value').innerText(),
  ]);
  await page.getByTestId('button-toggle-po-filters').click();
  await page.getByTestId('select-po-status').selectOption('open');
  await choose(page, 'select-po-vendor', refs.vendor.vendorName);
  await choose(page, 'select-po-product', refs.priced.name);
  await page.getByTestId('input-po-from').fill(persisted.items[0].poDate);
  await page.getByTestId('input-po-to').fill(persisted.items[0].poDate);
  await page.getByTestId('select-po-sort').selectOption('oldest');
  await page.getByTestId('input-search-purchase-orders').fill(savedOrderNumber);
  await expect(page.locator('.po-table .po-number').filter({ hasText: savedOrderNumber })).toBeVisible();
  await expect(page.getByTestId('text-po-open-count')).toHaveText(globalCardsBefore[0]);
  await expect(page.getByTestId('text-po-open-value')).toHaveText(globalCardsBefore[1]);
  await page.getByTestId('button-clear-po-filters').click();
  await expect(page.getByTestId('input-search-purchase-orders')).toHaveValue('');
  await expect(page.getByTestId('select-po-status')).toHaveValue('open');
  await expect(page.getByTestId('select-po-sort')).toHaveValue('recent');
  await expect(page.getByTestId('text-po-count')).toContainText('1');
  await expect(page.getByTestId('text-po-open-count')).toHaveText('1');

  await page.getByTestId('tab-po-activity').click();
  await expect(page.locator('.po-event').first()).toBeVisible();
  const event = page.locator('.po-event').filter({ hasText: savedOrderNumber });
  await expect(event).toContainText('created');
  await expect(event).toContainText('Super Admin');
  await expect(event.locator('time')).toHaveAttribute('datetime', /.+/);
  await expect(event.locator('a')).toHaveCount(0);
  await page.getByTestId('input-search-po-activity').fill(savedOrderNumber);
  await expect(event).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('po-activity.png'), fullPage: true });

  await page.getByTestId('tab-po-analytics').click();
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.po-event-counts')).toContainText('created changes');
  const vendorBar = page.locator('.po-bar').filter({ hasText: refs.vendor.vendorName });
  await expect(vendorBar).toBeVisible();
  await expect(vendorBar).toContainText(reviewedTotal);
  await page.screenshot({ path: test.info().outputPath('po-analytics.png'), fullPage: true });

  console.log(JSON.stringify({ savedOrderNumber, reviewedTotal, requestFailures: failedRequests, consoleErrors: browserErrors,
    deferred: 'Direct detail route and legacy browser stores were intentionally not exercised.' }));
  expect(failedRequests.filter((item) => !item.includes('ERR_ABORTED'))).toEqual([]);
});
