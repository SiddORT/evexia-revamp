import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
async function choose(page, id, name) {
  const control = page.getByTestId(`select-${id}`);
  await control.click();
  await control.fill(name.split(' (')[0]);
  await page.getByRole('listbox', { name: await control.getAttribute('aria-label'), exact: true }).getByRole('option', { name, exact: true }).click();
}
const call = (page, method, ...args) => page.evaluate(async ({ method, args }) => {
  const service = await import('/src/services/serverPurchaseOrders.js');
  return service[method](...args);
}, { method, args });

function requireDisposableFixture() {
  if (process.env.APP_ENV !== 'test' || process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1'
    || !process.env.TEST_DATABASE_URL?.includes('/evexia_po_smoke?host=/tmp/evexia-po-smoke.')) throw new Error('Disposable PO database required');
}

test.beforeEach(() => requireDisposableFixture());

function makeLegacy(id, oldBody) {
  // Deliberately only usable inside the private disposable fixture.
  requireDisposableFixture();
  execFileSync('python3', ['-c', `
import json, sys, uuid
from sqlalchemy import select
from app.db.session import session_factory
from app.db.purchase_order_models import PurchaseOrder, PurchaseOrderLine, PurchaseOrderRequest
from app.services.purchase_orders import digest
db = session_factory()()
row = db.get(PurchaseOrder, uuid.UUID(sys.argv[1]))
row.tax_basis = row.tax_components = None
for line in db.scalars(select(PurchaseOrderLine).where(PurchaseOrderLine.order_id == row.id)):
    line.snapshot = {k:v for k,v in line.snapshot.items() if k not in ("taxComponents","componentRates")}
body = json.loads(sys.argv[2])
from app.schemas.purchase_orders import POCreate
normalized = POCreate(**body).model_dump(mode="json")
normalized.pop("placeOfSupplyCode")
from app.services.purchase_orders import projection
response = projection(db, row)
response.pop("taxBasis"); response.pop("taxComponents")
db.add(PurchaseOrderRequest(key=uuid.UUID(body["idempotencyKey"]), actor_id=row.created_by,
    digest=digest(["created",None,normalized]), response=response))
db.commit()
db.close()
`, id, JSON.stringify(oldBody)], { stdio: 'pipe' });
}

test('live PO tax totals, snapshots, legacy data and original pending request reconciliation', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const refs = await page.evaluate(async () => {
    const vendors = await import('/src/services/serverVendors.js');
    const locations = await import('/src/services/serverLocations.js');
    const categories = await import('/src/services/serverProductCategories.js');
    const allergens = await import('/src/services/serverAllergens.js');
    const vendorData = { registeredAddress: 'Synthetic road', contactPersonName: 'Synthetic contact', emailId: 'po-tax@example.test', phoneNo: '9876543210', dialCountry: 'IN', status: 'active' };
    const mh = await vendors.createVendor({ ...vendorData, vendorName: 'Tax Maharashtra', gstNo: '27DDDDD3333D1Z8' });
    const ka = await vendors.createVendor({ ...vendorData, vendorName: 'Tax Karnataka', gstNo: '29EEEEE4444E1Z9' });
    const ut = await vendors.createVendor({ ...vendorData, vendorName: 'Tax Chandigarh', gstNo: '04FFFFF5555F1ZA' });
    const invalid = await vendors.createVendor({ ...vendorData, vendorName: 'Tax Unsupported', gstNo: '99GGGGG6666G1ZB' });
    const location = await locations.createLocation({ name: 'Tax test depot', address: 'Synthetic depot', status: 'active' });
    const category = await categories.createProductCategory({ name: 'Tax test category', description: '', unit_price: '0', status: 'active' });
    const create = (name, selling_price, gst) => allergens.createAllergen({ name, category_id: category.id, storage_location_id: location.id, selling_price, gst, concentration: 'Synthetic concentration', threshold_limit: null, status: 'active', mix: false });
    const product = await create('Tax product 18', '100', '18');
    const fractional = await create('Tax fractional product', '123.456789', '18.123457');
    const missing = await create('Tax unavailable price', null, '18');
    const zero = await create('Tax zero rated', '100', '0');
    return { mh, ka, ut, invalid, location, product, fractional, missing, zero };
  });
  await page.goto(`${base()}/admin/inventory/purchase-orders/new`);
  const summary = page.getByRole('complementary', { name: 'Order totals' });
  const total = summary.getByTestId('text-po-form-total');
  await expect(total).toHaveText('₹0.00');
  await choose(page, 'po-vendor', refs.mh.vendorName);
  await choose(page, 'po-location', refs.location.name);
  await page.getByTestId('input-po-expected-date').fill('2028-12-31');
  await choose(page, 'po-product-0', refs.product.name);
  await expect(total).toHaveText('Tax pending');
  await choose(page, 'po-place-of-supply', 'Maharashtra (27)');
  await expect(total).toHaveText('₹118.00');
  await expect(summary).toContainText('CGST');
  await expect(summary).toContainText('SGST');
  await page.getByTestId('button-add-po-line').click();
  await expect(total).toHaveText('₹118.00');
  await expect(summary).not.toContainText('Partial totals:');
  await expect(summary).toContainText('Draft estimate');
  await page.getByTestId('button-review-po').click();
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toHaveCount(0);
  await expect(page.getByText('Select a product.', { exact: true })).toBeVisible();
  await page.getByTestId('input-po-quantity-0').fill('2');
  await expect(total).toHaveText('₹236.00');
  await choose(page, 'po-product-0', refs.zero.name);
  await expect(total).toHaveText('₹200.00');
  await choose(page, 'po-product-0', refs.missing.name);
  await expect(page.getByText('Catalogue price unavailable. This line cannot be created.')).toBeVisible();
  await expect(total).toHaveText('₹0.00');
  await choose(page, 'po-product-0', refs.product.name);
  await page.getByTestId('button-remove-po-line-1').click();
  await expect(summary).not.toContainText('Partial totals');
  await choose(page, 'po-vendor', refs.ka.vendorName);
  await expect(summary).toContainText('IGST');
  await expect(summary).not.toContainText('CGST');
  await choose(page, 'po-place-of-supply', 'Karnataka (29)');
  await expect(summary).toContainText('CGST');
  await expect(summary).toContainText('SGST');
  await choose(page, 'po-vendor', refs.ut.vendorName);
  await choose(page, 'po-place-of-supply', 'Chandigarh (04)');
  await expect(summary).toContainText('UTGST');
  await expect(page.locator('.po-tax-context')).toContainText('04FFFFF5555F1ZA');
  await choose(page, 'po-vendor', refs.invalid.vendorName);
  await expect(total).toHaveText('Tax pending');
  await expect(page.locator('.po-tax-context')).toContainText('unsupported');
  await choose(page, 'po-vendor', refs.ka.vendorName);
  await choose(page, 'po-place-of-supply', 'Karnataka (29)');
  await choose(page, 'po-product-0', refs.fractional.name);
  await page.getByTestId('input-po-quantity-0').fill('3.125');
  const draftTotal = await total.innerText();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('input-po-quantity-0').scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const sticky = document.querySelector('aside[aria-label="Order totals"]').getBoundingClientRect();
    const input = document.querySelector('[data-testid="input-po-quantity-0"]').getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, stickyBottom: sticky.bottom, inputTop: input.top };
  });
  expect(layout.width).toBeLessThanOrEqual(391);
  expect(layout.stickyBottom).toBeLessThanOrEqual(layout.inputTop);
  await page.screenshot({ path: test.info().outputPath('tax-draft-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('button-review-po').click();
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible();
  await expect(page.locator('.po-new-summary').getByTestId('text-po-form-total')).toHaveText(draftTotal);
  // A vendor master change after review must invalidate the server review.
  await page.evaluate(async (vendor) => {
    const api = await import('/src/services/serverVendors.js');
    const current = await api.getVendor(vendor.id);
    const fields = Object.fromEntries(['vendorName', 'gstNo', 'registeredAddress', 'contactPersonName', 'emailId', 'phoneNo', 'dialCountry', 'status'].map((k) => [k, current[k]]));
    await api.editVendor(current, { ...fields, gstNo: '07EEEEE4444E1Z9' });
  }, refs.ka);
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByText('Catalogue prices, vendor tax basis or references changed since your review.', { exact: false })).toBeVisible();
  await page.getByTestId('button-review-po').click();
  await expect(page.locator('.po-tax-basis')).toContainText('IGST');
  await page.getByTestId('button-confirm-po').click();
  await expect(page).toHaveURL(/\/purchase-orders$/);
  const saved = (await call(page, 'listPurchaseOrders', {})).items[0];
  expect(saved.taxBasis.supplierStateCode).toBe('07');
  expect(saved.taxBasis.placeOfSupplyCode).toBe('29');
  expect(saved.taxComponents.igst).toBe(saved.gstAmount);
  await page.goto(`${base()}/admin/inventory/purchase-orders/${saved.id}`);
  await expect(page.locator('.po-items-table').getByTestId('text-po-form-total')).toHaveText(await page.evaluate(async (n) => (await import('/src/services/serverPurchaseOrders.js')).formatPaise(n), saved.total));
  await page.reload();
  await expect(page.locator('.po-tax-basis')).toContainText('Delhi (07)');
  await expect(page.locator('.po-tax-basis')).toContainText('Karnataka (29)');
  await page.getByTestId('button-edit-po').click();
  // Retained vendor must retain the saved GSTIN even if its master changed.
  await page.evaluate(async (vendor) => {
    const api = await import('/src/services/serverVendors.js');
    const current = await api.getVendor(vendor.id);
    const fields = Object.fromEntries(['vendorName', 'gstNo', 'registeredAddress', 'contactPersonName', 'emailId', 'phoneNo', 'dialCountry', 'status'].map((k) => [k, current[k]]));
    await api.editVendor(current, { ...fields, gstNo: '29EEEEE4444E1Z9' });
  }, refs.ka);
  await expect(page.locator('.po-tax-context')).toContainText('07EEEEE4444E1Z9');
  await page.getByTestId('input-po-quantity-0').fill('2');
  await page.getByTestId('button-review-po').click();
  await expect(page.locator('.po-tax-basis')).toContainText('Delhi (07)');
  // Commit but lose acknowledgement; route reload must retry original edit identity.
  const editRoute = '**/api/v1/admin/purchase-orders/*/edit';
  let lostEdit;
  await page.route(editRoute, async (route) => {
    lostEdit = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByTestId('button-confirm-po')).toHaveText('Retry and confirm');
  await page.unroute(editRoute);
  await page.reload();
  await expect(page.getByTestId('button-confirm-po')).toHaveText('Retry and confirm');
  let retryBody;
  await page.route(editRoute, async (route) => { retryBody = route.request().postDataJSON(); await route.continue(); });
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByTestId('button-edit-po')).toBeVisible();
  expect(retryBody).toEqual(lostEdit);
  await page.unroute(editRoute);
  const updated = await call(page, 'getPurchaseOrder', saved.id);
  expect(updated.version).toBe(2);

  // Seed a genuine aggregate-only legacy record and committed pre-upgrade request,
  // exclusively within this harness's private PostgreSQL socket.
  const oldInput = { poDate: updated.poDate, expectedDate: updated.expectedDate, vendorId: updated.vendorId, locationId: updated.locationId,
    lines: updated.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })) };
  const oldBody = { ...oldInput, reviewToken: 'a'.repeat(64), idempotencyKey: crypto.randomUUID() };
  makeLegacy(saved.id, oldBody);
  await page.reload();
  await expect(page.getByText('Historical tax breakdown unavailable.', { exact: false })).toBeVisible();
  await page.getByTestId('button-edit-po').click();
  await expect(page.getByTestId('select-po-place-of-supply')).toHaveValue('');
  await page.getByRole('button', { name: 'Load current vendor tax basis for this edit' }).click();
  await expect(page.locator('.po-tax-context')).toContainText('29EEEEE4444E1Z9');
  await choose(page, 'po-place-of-supply', 'Karnataka (29)');
  await page.getByTestId('button-review-po').click();
  await expect(page.locator('.po-tax-basis')).toContainText('CGST + SGST');
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByTestId('button-edit-po')).toBeVisible();
  // Simulate the original browser-local pre-upgrade pending create journal.
  await page.evaluate(async ({ saved, oldInput, oldBody }) => {
    const auth = await import('/src/auth/adminSession.js');
    const owner = String(auth.getSession().user.id);
    const legacyOrder = { ...saved, lines: saved.lines.map(({ taxComponents, componentRates, ...line }) => line) };
    delete legacyOrder.taxBasis; delete legacyOrder.taxComponents;
    localStorage.setItem(`evexia.po.pending-create:${owner}`, JSON.stringify({
      owner, key: oldBody.idempotencyKey, fingerprint: JSON.stringify({ input: oldInput, token: oldBody.reviewToken }),
      reviewToken: oldBody.reviewToken, order: legacyOrder,
      values: { poDate: oldInput.poDate, expectedDate: oldInput.expectedDate,
        vendor: { id: saved.vendorId, name: saved.vendorName }, location: { id: saved.locationId, name: saved.locationName },
        lines: saved.lines.map((l, i) => ({ key: `old-${i}`, quantity: l.quantity, product: { id: l.productId, name: l.productName, unitPrice: l.unitPrice, gst: l.gst } })) },
    }));
  }, { saved: updated, oldInput, oldBody });
  await page.goto(`${base()}/admin/inventory/purchase-orders/new`);
  await expect(page.getByTestId('button-confirm-po')).toHaveText('Retry and confirm');
  let oldRetried;
  await page.route('**/api/v1/admin/purchase-orders', async (route) => {
    if (route.request().method() === 'POST') oldRetried = route.request().postDataJSON();
    await route.continue();
  });
  await page.getByTestId('button-confirm-po').click();
  await expect(page).toHaveURL(/\/purchase-orders$/);
  expect(oldRetried).toEqual(oldBody); // no added destination, changed token or new UUID
  expect((await call(page, 'listPurchaseOrders', {})).filtered).toBe(1);
  await page.goto(`${base()}/admin/inventory/purchase-orders/${saved.id}`);
  await expect(page.locator('.po-tax-basis')).toContainText('CGST + SGST');
  await page.screenshot({ path: test.info().outputPath('tax-saved-detail.png'), fullPage: true });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ savedId: saved.id, componentRounding: true, legacyRetryOriginalIdentity: true, isolatedDatabase: true }));
});

async function structuredDraft(page, supplierCode = '27') {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const refs = await page.evaluate(async (supplierCode) => {
    const vendors = await import('/src/services/serverVendors.js');
    const locations = await import('/src/services/serverLocations.js');
    const categories = await import('/src/services/serverProductCategories.js');
    const allergens = await import('/src/services/serverAllergens.js');
    const tag = crypto.randomUUID();
    const vendor = await vendors.createVendor({
      vendorName: `Structured vendor ${tag}`, gstNo: `${supplierCode}DDDDD3333D1Z8`,
      registeredAddress: 'Synthetic supplier road', contactPersonName: 'Synthetic contact',
      emailId: 'structured-po@example.test', phoneNo: '9876543210', dialCountry: 'IN', status: 'active',
    });
    const make = (label, countryCode = '', state = '') => locations.createLocation({
      name: `${label} ${tag}`, address: 'Maharashtra 400001 India (unstructured text only)',
      countryCode, state, city: '', pincode: '', status: 'active',
    });
    const mh = await make('Structured Maharashtra', 'IN', '27');
    const ka = await make('Structured Karnataka', 'IN', 'Karnataka');
    const ut = await make('Structured Chandigarh', 'IN', '04');
    const alias = await make('Structured Odisha alias', 'IN', 'Orissa');
    const missing = await make('Legacy geography');
    const noState = await make('Indian missing state', 'IN');
    // A familiar Indian state name in another country is not an Indian destination.
    const foreign = await make('Foreign geography', 'US', 'Maharashtra');
    const category = await categories.createProductCategory({ name: `Structured category ${tag}`, description: '', unit_price: '0', status: 'active' });
    const product = await allergens.createAllergen({
      name: `Structured product ${tag}`, category_id: category.id, storage_location_id: mh.id,
      selling_price: '100', gst: '18', concentration: 'Synthetic', threshold_limit: null, status: 'active', mix: false,
    });
    return { vendor, mh, ka, ut, alias, missing, noState, foreign, product };
  }, supplierCode);
  await page.goto(`${base()}/admin/inventory/purchase-orders/new`);
  await choose(page, 'po-vendor', refs.vendor.vendorName);
  await page.getByTestId('input-po-expected-date').fill('2028-12-31');
  await choose(page, 'po-product-0', refs.product.name);
  return refs;
}

const destination = (page) => page.getByTestId('select-po-place-of-supply');
const locationControl = (page) => page.getByTestId('select-po-location');
const destinationDialog = (page) => page.getByRole('dialog', { name: 'Review delivery destination', exact: true });

test('structured locations suggest canonical states and clear automatic destinations for missing or foreign geography', async ({ page }) => {
  const refs = await structuredDraft(page);
  for (const [location, label] of [[refs.mh, 'Maharashtra (27)'], [refs.alias, 'Odisha (21)'], [refs.ut, 'Chandigarh (04)']]) {
    await choose(page, 'po-location', location.name);
    await expect(destination(page)).toHaveValue(label);
    await expect(destinationDialog(page)).toHaveCount(0);
    await expect(page.locator('.po-tax-context')).toContainText('Destination suggested by the selected storage location.');
  }
  for (const location of [refs.missing, refs.noState, refs.foreign]) {
    // Every negative case starts with a valid automatic suggestion.
    await choose(page, 'po-location', refs.mh.name);
    await expect(destination(page)).toHaveValue('Maharashtra (27)');
    await choose(page, 'po-location', location.name);
    await expect(locationControl(page)).toHaveValue(location.name);
    await expect(destination(page)).toHaveValue('');
    await expect(destinationDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('text-po-form-total')).toHaveText('Tax pending');
    await expect(page.locator('.po-tax-context')).toContainText('no previous suggestion is retained');
    await page.getByTestId('button-review-po').click();
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toHaveCount(0);
    await expect(page.getByText('Select a supported State/UT.', { exact: true })).toBeVisible();
  }
});

test('manual delivery exceptions require explicit cancel keep use or clear when storage changes', async ({ page }) => {
  const refs = await structuredDraft(page);
  await choose(page, 'po-location', refs.mh.name);
  await choose(page, 'po-place-of-supply', 'Delhi (07)');
  const dialog = destinationDialog(page);
  await choose(page, 'po-location', refs.ka.name);
  await expect(dialog).toBeVisible();
  await expect(destination(page)).toHaveValue('Delhi (07)');
  await expect(locationControl(page)).toHaveValue(refs.mh.name);
  await dialog.getByRole('button', { name: 'Cancel location change', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(locationControl(page)).toHaveValue(refs.mh.name);
  await expect(destination(page)).toHaveValue('Delhi (07)');

  await choose(page, 'po-location', refs.ka.name);
  await dialog.getByRole('button', { name: 'Keep current destination', exact: true }).click();
  await expect(locationControl(page)).toHaveValue(refs.ka.name);
  await expect(destination(page)).toHaveValue('Delhi (07)');
  await expect(page.locator('.po-tax-context')).toContainText('Manually selected destination.');
  await choose(page, 'po-location', refs.ut.name);
  await dialog.getByRole('button', { name: 'Use location State/UT', exact: true }).click();
  await expect(locationControl(page)).toHaveValue(refs.ut.name);
  await expect(destination(page)).toHaveValue('Chandigarh (04)');
  // "Use" restores automatic provenance: the next switch needs no confirmation.
  await choose(page, 'po-location', refs.mh.name);
  await expect(dialog).toHaveCount(0);
  await expect(destination(page)).toHaveValue('Maharashtra (27)');

  for (const location of [refs.missing, refs.foreign]) {
    await choose(page, 'po-place-of-supply', 'Delhi (07)');
    await choose(page, 'po-location', location.name);
    await expect(dialog).toContainText('no usable Indian State/UT');
    await dialog.getByRole('button', { name: 'Keep current destination', exact: true }).click();
    await expect(locationControl(page)).toHaveValue(location.name);
    await expect(destination(page)).toHaveValue('Delhi (07)');
    await choose(page, 'po-location', refs.mh.name);
    await dialog.getByRole('button', { name: 'Keep current destination', exact: true }).click();
    await choose(page, 'po-location', location.name);
    await dialog.getByRole('button', { name: 'Clear destination and select manually', exact: true }).click();
    await expect(locationControl(page)).toHaveValue(location.name);
    await expect(destination(page)).toHaveValue('');
    await expect(page.getByTestId('text-po-form-total')).toHaveText('Tax pending');
    await choose(page, 'po-location', refs.mh.name);
    await expect(destination(page)).toHaveValue('Maharashtra (27)');
  }
});

for (const [supplier, depot, code, label, treatment, components] of [
  ['27', 'mh', '27', 'Maharashtra (27)', 'cgst_sgst', { cgst: 900, sgst: 900, utgst: 0, igst: 0 }],
  ['27', 'ka', '29', 'Karnataka (29)', 'igst', { cgst: 0, sgst: 0, utgst: 0, igst: 1800 }],
  ['04', 'ut', '04', 'Chandigarh (04)', 'cgst_utgst', { cgst: 900, sgst: 0, utgst: 900, igst: 0 }],
]) {
  test(`structured destination ${treatment} has authoritative review/save parity and survives storage master edits`, async ({ page }) => {
    test.setTimeout(120_000);
    const refs = await structuredDraft(page, supplier);
    const selected = refs[depot];
    await choose(page, 'po-location', selected.name);
    await expect(destination(page)).toHaveValue(label);
    await expect(page.getByTestId('text-po-form-total')).toHaveText('₹118.00');
    const reviewing = page.waitForResponse((response) => response.url().endsWith('/purchase-orders/preview') && response.request().method() === 'POST');
    await page.getByTestId('button-review-po').click();
    const response = await reviewing;
    expect(response.status()).toBe(200);
    const review = await response.json();
    expect(response.request().postDataJSON().placeOfSupplyCode).toBe(code);
    expect(review.order.taxBasis.placeOfSupplyCode).toBe(code);
    expect(review.order.taxBasis.treatment).toBe(treatment);
    expect(review.order.taxComponents).toEqual(components);
    await expect(page.locator('.po-tax-basis')).toContainText(label);
    await expect(page.locator('.po-new-summary').getByTestId('text-po-form-total')).toHaveText('₹118.00');
    // Assert each visible component, not just the total (all regimes total ₹118).
    for (const [key, amount] of Object.entries(components).filter(([, amount]) => amount)) {
      await expect(page.locator('.po-new-summary dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${key}$`, 'i') }) }).locator('dd')).toHaveText(`₹${(amount / 100).toFixed(2)}`);
    }
    const saving = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/purchase-orders') && response.request().method() === 'POST');
    await page.getByTestId('button-confirm-po').click();
    const savedResponse = await saving;
    expect(savedResponse.status()).toBe(201);
    const saved = await savedResponse.json();
    await expect(page).toHaveURL(/\/purchase-orders$/);
    for (const key of ['taxBasis', 'taxComponents', 'subtotal', 'gstAmount', 'total', 'locationName']) {
      expect(saved[key]).toEqual(review.order[key]);
    }
    expect(saved.lines[0].taxComponents).toEqual(components);
    expect(saved.lines[0].componentRates).toEqual(review.order.lines[0].componentRates);
    await page.evaluate(async (selected) => {
      const api = await import('/src/services/serverLocations.js');
      const current = await api.getLocation(selected.id);
      const fields = Object.fromEntries(['name', 'address', 'status', 'pincode', 'countryCode', 'state', 'city'].map((key) => [key, current[key]]));
      await api.editLocation(current, { ...fields, name: `Renamed ${current.name}`, countryCode: 'US', state: 'Maharashtra', address: 'Changed synthetic foreign address' });
    }, selected);
    expect(await call(page, 'getPurchaseOrder', saved.id)).toEqual(saved);
    await page.goto(`${base()}/admin/inventory/purchase-orders/${saved.id}`);
    await expect(page.getByTestId('button-edit-po')).toBeVisible();
    await expect(page.locator('.po-tax-basis')).toContainText(label);
    await page.reload();
    await expect(page.getByTestId('button-edit-po')).toBeVisible();
    await page.getByTestId('button-edit-po').click();
    await expect(destination(page)).toHaveValue(label);
    await expect(locationControl(page)).toHaveValue(selected.name);
    await expect(page.locator('.po-tax-context')).toContainText('Saved destination retained');
    // A saved destination has the same explicit-decision protection as a manual one.
    await choose(page, 'po-location', refs.missing.name);
    await expect(destinationDialog(page)).toBeVisible();
    await destinationDialog(page).getByRole('button', { name: 'Cancel location change', exact: true }).click();
    await expect(locationControl(page)).toHaveValue(selected.name);
    await expect(destination(page)).toHaveValue(label);
    await page.getByTestId('input-po-quantity-0').fill('2');
    await page.getByTestId('button-review-po').click();
    await expect(page.locator('.po-tax-basis')).toContainText(label);
    await expect(page.locator('.po-new-summary').getByTestId('text-po-form-total')).toHaveText('₹236.00');
    await page.getByTestId('button-confirm-po').click();
    await expect(page.getByTestId('button-edit-po')).toBeVisible();
    const edited = await call(page, 'getPurchaseOrder', saved.id);
    expect(edited.taxBasis).toEqual(saved.taxBasis);
    expect(edited.locationName).toBe(saved.locationName);
    expect(edited.taxComponents).toEqual(Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value * 2])));
  });
}
