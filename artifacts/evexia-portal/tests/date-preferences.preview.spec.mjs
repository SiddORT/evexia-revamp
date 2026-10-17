import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { formatCalendarDate, formatTimestamp } from '../src/services/datePresentation.js';
import fs from 'node:fs/promises';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const preferences = { dateFormat: 'mm-dd-yyyy', timeZone: 'America/Los_Angeles', clock: '24' };
const calendar = (value) => formatCalendarDate(value, preferences);
const stamp = (value, seconds = false) => formatTimestamp(value, preferences, seconds);

test('General dates persist across mounted masters, procurement, native controls and inventory', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/settings?tab=basic`);
  await page.getByTestId('select-admin-date-format').selectOption(preferences.dateFormat);
  await page.getByTestId('select-admin-time-zone').selectOption(preferences.timeZone);
  await page.getByTestId('select-admin-clock').selectOption(preferences.clock);
  await expect(page.getByTestId('text-admin-date-preview')).toHaveText('Calendar date: 09/30/2026');
  await expect(page.getByTestId('text-admin-time-preview')).toHaveText(`Timestamp: ${stamp('2026-09-30T18:45:00Z')}`);
  await expect(page.getByText(/Native date entry controls follow your browser/)).toBeVisible();

  // Real synthetic masters and server PO, with ordinary authenticated transports.
  const seeded = await page.evaluate(async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { createZone } = await import('/src/services/serverZones.js');
    const zone = await createZone({ name: `Date convention ${suffix}`, status: 'active' });
    const { createVendor } = await import('/src/services/serverVendors.js');
    const { createLocation } = await import('/src/services/serverLocations.js');
    const { createProductCategory } = await import('/src/services/serverProductCategories.js');
    const { createAllergen } = await import('/src/services/serverAllergens.js');
    const po = await import('/src/services/serverPurchaseOrders.js');
    const vendor = await createVendor({ vendorName: `Date Vendor ${suffix}`, gstNo: '27DDDDD3333D1Z8', registeredAddress: 'Synthetic Road', contactPersonName: 'Test Contact', emailId: `date-${suffix}@example.test`, phoneNo: '9876543210', dialCountry: 'IN', status: 'active' });
    const location = await createLocation({ name: `Date Depot ${suffix}`, address: 'Synthetic Depot', status: 'active' });
    const category = await createProductCategory({ name: `Date Category ${suffix}`, description: '', unit_price: '0.000000', status: 'active' });
    const product = await createAllergen({ name: `Date Product ${suffix}`, category_id: category.id, storage_location_id: location.id, selling_price: '123.456789', gst: '18.123456', concentration: 'Synthetic', threshold_limit: null, status: 'active', mix: false });
    const input = { poDate: '2026-01-01', expectedDate: '2026-01-05', vendorId: vendor.id, locationId: location.id, placeOfSupplyCode: '27', lines: [{ productId: product.id, quantity: '2' }] };
    const reviewed = await po.previewPurchaseOrder(input);
    const order = await po.createPurchaseOrder(input, reviewed.reviewToken, crypto.randomUUID());
    return { zone, order };
  });
  await page.goto(`${base()}/admin/masters/zones`);
  const zoneRow = page.getByTestId(`row-zone-${seeded.zone.id}`);
  await expect(zoneRow).toContainText(stamp(seeded.zone.createdAt));
  // Preference notification must update an already mounted consumer, without a fetch.
  await page.evaluate(async () => {
    const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
    setAdminPreference('dateFormat', 'dd-mm-yyyy');
  });
  await expect(zoneRow).toContainText(formatTimestamp(seeded.zone.createdAt, { ...preferences, dateFormat: 'dd-mm-yyyy' }));
  await page.evaluate(async () => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('dateFormat', 'mm-dd-yyyy'));

  await page.goto(`${base()}/admin/inventory/purchase-orders`);
  await expect(page.getByTestId(`row-po-${seeded.order.id}`)).toContainText('01/01/2026');
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator('.po-card').filter({ hasText: seeded.order.number })).toContainText('01/05/2026');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base()}/admin/inventory/purchase-orders/${seeded.order.id}`);
  const orderDetails = page.locator('.po-detail-grid').filter({ has: page.getByText('PO date', { exact: true }) });
  await expect(orderDetails).toContainText('01/01/2026');
  await expect(orderDetails).toContainText(stamp(seeded.order.createdAt, true));
  await page.getByTestId('button-edit-po').click();
  await expect(page.getByTestId('input-po-date')).toHaveValue('2026-01-01');
  await expect(page.getByTestId('input-po-expected-date')).toHaveValue('2026-01-05');
  await page.getByTestId('button-cancel-po').click();

  await page.goto(`${base()}/admin/inventory/stock-status`);
  await page.getByTestId('button-view-stock-demo-dust').click();
  const history = page.locator('.stock-history-table tbody tr').first();
  await expect(history).toBeVisible();
  await expect(history.locator('td').first()).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/);
  await page.keyboard.press('Escape');
  await page.getByTestId('button-inventory-report').click();
  await expect(page.getByTestId('stock-report')).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/);
  await page.screenshot({ path: info.outputPath('preferred-stock-report.png') });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('General dates in reports preserve explicit UTC filter semantics', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/settings?tab=basic`);
  await page.getByTestId('select-admin-date-format').selectOption(preferences.dateFormat);
  await page.getByTestId('select-admin-time-zone').selectOption(preferences.timeZone);
  await page.getByTestId('select-admin-clock').selectOption(preferences.clock);
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('button-activity-filters').click();
  await expect(page.getByTestId('input-activity-start')).toBeVisible();
  await expect(page.getByLabel('Start date (UTC)', { exact: true })).toHaveAttribute('type', 'date');
  await expect(page.locator('.alog-stat__time')).toHaveText(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
  expect(errors).toEqual([]);
});

test('General dates in mounted documents and downloads persist after reload', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/settings?tab=basic`);
  await page.getByTestId('select-admin-date-format').selectOption(preferences.dateFormat);
  await page.getByTestId('select-admin-time-zone').selectOption(preferences.timeZone);
  await page.getByTestId('select-admin-clock').selectOption(preferences.clock);
  // Seed only the separate, fictional browser-local receiving workspace.
  const receipt = await page.evaluate(async () => {
    const pr = await import('/src/services/purchaseReceived.js');
    // A fresh local load already initializes its sample POs and masters.
    // Explicit PO seeding is only for an existing empty workspace.
    const snapshot = await pr.guardedSeedSamplePRs(pr.loadPRSnapshot());
    return snapshot.record.receipts[0];
  });
  await page.goto(`${base()}/admin/inventory/purchase-received/${receipt.id}`);
  await expect(page.locator('.po-summary')).toContainText(calendar(receipt.receivedDate));
  await page.getByTestId('button-preview-pr').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region', { name: 'Purchase Received details' })).toContainText(calendar(receipt.receivedDate));
  const documentPage = dialog.locator('.pr-document-pages__page svg').first();
  await expect(documentPage).toContainText(calendar(receipt.receivedDate));
  // A mounted preview, accessible text and PDF must all follow the same snapshot.
  await page.evaluate(async () => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('dateFormat', 'dd-mmm-yyyy'));
  const changedDate = formatCalendarDate(receipt.receivedDate, { ...preferences, dateFormat: 'dd-mmm-yyyy' });
  await expect(documentPage).toContainText(changedDate);
  await expect(dialog.getByRole('region', { name: 'Purchase Received details' })).toContainText(changedDate);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-download-pr-document').click();
  const download = await downloadPromise;
  const pdf = await fs.readFile(await download.path());
  assertSearchableDate(pdf, changedDate);
  await page.screenshot({ path: info.outputPath('preferred-pr-preview.png') });
  await page.getByTestId('button-close-pr-document').click();

  await page.goto(`${base()}/admin/settings?tab=templates`);
  await expect(page.locator('.po-tpl__gallery svg').first()).toContainText('01 Oct 2026');
  await page.evaluate(async () => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('dateFormat', 'yyyy-mm-dd'));
  await expect(page.locator('.po-tpl__gallery svg').first()).toContainText('2026-10-01');
  await page.getByLabel('Document type', { exact: true }).selectOption('pr');
  await expect(page.locator('.po-tpl__gallery svg').first()).toContainText('2026-10-04');
  await page.goto(`${base()}/admin/settings?tab=basic`);
  await page.reload();
  await expect(page.getByTestId('select-admin-date-format')).toHaveValue('yyyy-mm-dd');
  await expect(page.getByTestId('select-admin-time-zone')).toHaveValue(preferences.timeZone);
  await expect(page.getByTestId('select-admin-clock')).toHaveValue('24');
  await expect(page.getByTestId('text-admin-date-preview')).toHaveText('Calendar date: 2026-09-30');
  expect(errors).toEqual([]);
});

function assertSearchableDate(pdf, text) {
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  // Dates use the ASCII subset of the renderer's searchable WinAnsi glyphs.
  const glyphText = [...pdf.toString('latin1').matchAll(/<([0-9a-f]{2})> Tj/gi)]
    .map((match) => String.fromCharCode(parseInt(match[1], 16))).join('');
  expect(glyphText).toContain(text);
}
