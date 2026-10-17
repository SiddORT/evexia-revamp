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
    const vendors = await import('/src/services/serverVendors.js');
    const locations = await import('/src/services/serverLocations.js');
    const categories = await import('/src/services/serverProductCategories.js');
    const allergens = await import('/src/services/serverAllergens.js');
    const orders = await import('/src/services/serverPurchaseOrders.js');
    const vendor = await vendors.createVendor({
      vendorName: `PO Mutation Vendor ${suffix}`, gstNo: '27DDDDD3333D1Z8',
      registeredAddress: 'Synthetic test road', contactPersonName: 'Synthetic Contact',
      emailId: `po-mutation-${suffix}@example.test`, phoneNo: '9876543210', dialCountry: 'IN', status: 'active',
    });
    const location = await locations.createLocation({ name: `PO Mutation Storage ${suffix}`, address: 'Synthetic depot', status: 'active' });
    const category = await categories.createProductCategory({ name: `PO Mutation Category ${suffix}`, description: '', unit_price: '0.000000', status: 'active' });
    const product = await allergens.createAllergen({
      name: `PO Mutation Allergen ${suffix}`, category_id: category.id, storage_location_id: location.id,
      selling_price: '123.456789', gst: '18.123456', concentration: 'Synthetic test item',
      threshold_limit: null, status: 'active', mix: false,
    });
    const input = {
      placeOfSupplyCode: '27',
      vendorId: vendor.id, locationId: location.id, poDate: '2028-12-30', expectedDate: '2028-12-31',
      lines: [{ productId: product.id, quantity: '1' }, { productId: product.id, quantity: '2' }],
    };
    const reviewed = await orders.previewPurchaseOrder(input);
    const order = await orders.createPurchaseOrder(input, reviewed.reviewToken, crypto.randomUUID());
    return { vendor, location, category, product, input, order };
  }, suffix);
}

test('protected server PO detail, edit conflict/retry, and soft-delete retry', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const refs = await loginAndSeed(page);
  const orderId = refs.order.id;
  const detailUrl = `${base()}/admin/inventory/purchase-orders/${orderId}`;
  const listingUrl = `${base()}/admin/inventory/purchase-orders`;
  const byService = async (callback, ...args) => page.evaluate(async ({ callback, args }) => {
    const service = await import('/src/services/serverPurchaseOrders.js');
    return service[callback](...args);
  }, { callback, args });

  // Resume after the already-observed create/detail/snapshot/edit segment. Prepare
  // its version-2 state through isolated server services; browser assertions below
  // cover only the not-yet-run overview remainder and conflict/retry/delete journey.
  await page.evaluate(async (product) => {
    const api = await import('/src/services/serverAllergens.js');
    const current = await api.getAllergen(product.id);
    await api.editAllergen(current, {
      name: current.name, category_id: current.category_id, storage_location_id: current.storage_location_id,
      selling_price: '999.000001', gst: '31.000001', concentration: current.concentration,
      threshold_limit: current.threshold_limit, status: current.status, mix: current.mix,
    });
  }, refs.product);
  const firstEdit = await byService('getPurchaseOrder', orderId);
  const firstEditInput = {
    placeOfSupplyCode: firstEdit.taxBasis.placeOfSupplyCode,
    poDate: firstEdit.poDate, expectedDate: firstEdit.expectedDate, vendorId: firstEdit.vendorId, locationId: firstEdit.locationId,
    lines: firstEdit.lines.map((line, index) => ({ productId: line.productId, quantity: index === 0 ? '3' : line.quantity })),
  };
  const firstReview = await byService('previewPurchaseOrderEdit', orderId, firstEditInput);
  await byService('updatePurchaseOrder', orderId, firstEditInput, firstEdit.version, firstReview.reviewToken, crypto.randomUUID());
  const afterFirstEdit = await byService('getPurchaseOrder', orderId);
  expect(afterFirstEdit.version).toBe(2);
  expect(afterFirstEdit.lines.map((line) => line.quantity)).toEqual(['3', '2']);
  expect(afterFirstEdit.lines.every((line) => line.unitPrice === '123.456789' && line.gst === '18.123456')).toBe(true);

  await page.goto(detailUrl);
  await expect(page.getByText('Status: open · Version 2')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mutation-detail-v2.png'), fullPage: true });

  // Global overview, activity, and analytics reflect the committed server edit.
  await page.getByRole('button', { name: 'All orders' }).click();
  await expect(page.getByTestId('text-po-open-count')).toHaveText('1');
  await expect(page.getByTestId('text-po-open-value')).toContainText('₹');
  await page.getByTestId('tab-po-activity').click();
  const activity = page.locator('.po-event').filter({ hasText: refs.order.number }).filter({ hasText: 'updated' });
  await expect(activity).toContainText('updated');
  await page.getByTestId('tab-po-analytics').click();
  await expect(page.locator('.po-event-counts')).toContainText('updated');

  // Competing server update after review must reject stale version without losing draft.
  await page.goto(detailUrl);
  await page.getByTestId('button-edit-po').click();
  await page.getByTestId('input-po-quantity-0').fill('4');
  await page.getByTestId('button-review-po').click();
  const competitor = await byService('getPurchaseOrder', orderId);
  const competingInput = {
    placeOfSupplyCode: competitor.taxBasis.placeOfSupplyCode,
    poDate: competitor.poDate, expectedDate: competitor.expectedDate, vendorId: competitor.vendorId, locationId: competitor.locationId,
    lines: competitor.lines.map((line, index) => ({ productId: line.productId, quantity: index === 0 ? '5' : line.quantity })),
  };
  const competingReview = await byService('previewPurchaseOrderEdit', orderId, competingInput);
  await byService('updatePurchaseOrder', orderId, competingInput, competitor.version, competingReview.reviewToken, crypto.randomUUID());
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByRole('alert')).toContainText('Another session changed or deleted this order');
  await expect(page.getByTestId('input-po-quantity-0')).toHaveValue('4');
  const reloadDraft = page.getByRole('button', { name: 'Reload latest order' });
  await expect(reloadDraft).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await reloadDraft.click();
  await expect(page.getByText('Status: open · Version 3')).toBeVisible();
  await expect(page.getByTestId('button-edit-po')).toBeVisible();

  // Commit an edit but drop its response. Reopen the route and retry the exact pending request.
  await page.getByTestId('button-edit-po').click();
  await page.getByTestId('input-po-quantity-0').fill('6');
  await page.getByTestId('button-review-po').click();
  let editBodies = [];
  let editDropped = false;
  await page.route(`**/api/v1/admin/purchase-orders/${orderId}/edit`, async (route) => {
    editBodies.push(route.request().postDataJSON());
    if (!editDropped) { editDropped = true; await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByRole('alert')).toContainText('server did not confirm');
  await expect(page.getByTestId('button-confirm-po')).toHaveText('Retry and confirm');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible();
  await expect(page.getByTestId('button-confirm-po')).toHaveText('Retry and confirm');
  await page.getByTestId('button-confirm-po').click();
  await expect(page.getByText('Status: open · Version 4')).toBeVisible();
  expect(editBodies).toHaveLength(2);
  expect(editBodies[1]).toEqual(editBodies[0]);
  await page.unroute(`**/api/v1/admin/purchase-orders/${orderId}/edit`);
  const afterRetry = await byService('getPurchaseOrder', orderId);
  expect(afterRetry.lines[0].quantity).toBe('6');
  const beforeDeleteActivity = (await byService('listPurchaseOrderActivity', { query: refs.order.number, limit: 25, offset: 0 })).items
    .filter((event) => event.action === 'updated').length;

  // Cancel is non-mutating; deletion then follows the same lost-response retry discipline.
  let deleteRequests = 0;
  page.on('request', (request) => { if (request.url().includes(`/purchase-orders/${orderId}/delete`)) deleteRequests++; });
  await page.getByTestId('button-delete-po').click();
  await expect(page.getByRole('dialog', { name: `Delete ${refs.order.number}?` })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deleteRequests).toBe(0);
  await page.getByTestId('button-delete-po').click();
  let deleteBodies = [];
  let deleteDropped = false;
  await page.route(`**/api/v1/admin/purchase-orders/${orderId}/delete`, async (route) => {
    deleteBodies.push(route.request().postDataJSON());
    if (!deleteDropped) { deleteDropped = true; await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByRole('dialog').getByTestId('button-confirm-action').click();
  await expect(page.getByRole('alert')).toContainText('Deletion is unconfirmed');
  await expect(page.getByRole('dialog').getByTestId('button-confirm-action')).toHaveText('Retry deletion');
  await page.reload();
  await expect(page.getByRole('dialog').getByTestId('button-confirm-action')).toHaveText('Retry deletion');
  await page.getByRole('dialog').getByTestId('button-confirm-action').click();
  await expect(page.getByText('Status: deleted · Version 5')).toBeVisible();
  expect(deleteBodies).toHaveLength(2);
  expect(deleteBodies[1]).toEqual(deleteBodies[0]);
  await expect(page.getByTestId('button-edit-po')).toHaveCount(0);
  await expect(page.getByTestId('button-delete-po')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('mutation-detail-deleted.png'), fullPage: true });

  await page.goto(listingUrl);
  await expect(page.locator('.po-table .po-number').filter({ hasText: refs.order.number })).toHaveCount(0);
  await page.getByTestId('button-toggle-po-filters').click();
  await page.getByTestId('select-po-status').selectOption('deleted');
  const deletedLink = page.locator('.po-table .po-number').filter({ hasText: refs.order.number });
  await expect(deletedLink).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.po-mobile .po-number').filter({ hasText: refs.order.number })).toBeVisible();
  await page.locator('.po-mobile .po-number').filter({ hasText: refs.order.number }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText('Status: deleted · Version 5')).toBeVisible();

  await page.goto(listingUrl);
  await page.getByTestId('tab-po-activity').click();
  const deletedEvent = page.locator('.po-event').filter({ hasText: refs.order.number }).filter({ hasText: 'deleted' }).first();
  await expect(deletedEvent).toBeVisible();
  await deletedEvent.getByRole('link', { name: `View ${refs.order.number}` }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText('Status: deleted · Version 5')).toBeVisible();
  const finalActivity = (await byService('listPurchaseOrderActivity', { query: refs.order.number, limit: 25, offset: 0 })).items;
  expect(finalActivity.filter((event) => event.action === 'updated')).toHaveLength(beforeDeleteActivity);
  expect(finalActivity.filter((event) => event.action === 'deleted')).toHaveLength(1);
  console.log(JSON.stringify({ orderNumber: refs.order.number, initialVersion: 1, finalVersion: 5, editRetryBodies: editBodies, deleteRetryBodies: deleteBodies }));
});
