import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const listingPath = '/admin/inventory/purchase-orders';

// Never seed or delete against the managed preview or an operator-supplied API.
// scripts/test-purchase-orders-smoke.sh owns the disposable database and listeners.
test.beforeEach(async ({ page }) => {
  const url = new URL(base());
  if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || process.env.APP_ENV !== 'test'
    || !process.env.TEST_DATABASE_URL?.includes('/evexia_po_smoke?host=/tmp/evexia-po-smoke.')) {
    throw new Error('PO mutation tests require the disposable PO smoke fixture.');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

const serviceCall = (page, method, ...args) => page.evaluate(async ({ method, args }) => {
  const service = await import('/src/services/serverPurchaseOrders.js');
  return service[method](...args);
}, { method, args });

const deletionDialog = (page, order) => page.getByRole('dialog', { name: `Delete ${order.number}?`, exact: true });
const rowFor = (page, order) => page.locator('.po-table tbody tr').filter({ has: page.getByRole('link', { name: order.number, exact: true }) });
const detailUrlFor = (order) => `${base()}${listingPath}/${order.id}`;

async function openDeletion(page, order, entry) {
  if (entry === 'listing') {
    await page.goto(`${base()}${listingPath}`);
    await page.getByTestId('input-search-purchase-orders').fill(order.number);
    const trigger = rowFor(page, order).getByRole('button', { name: `Delete ${order.number}`, exact: true });
    await trigger.click();
    return trigger;
  }
  await page.goto(detailUrlFor(order));
  const trigger = page.getByTestId('button-delete-po');
  await trigger.click();
  return trigger;
}

async function expectRetryState(page, order, status) {
  await expect.poll(async () => (await serviceCall(page, 'loadOrderMutation', order.id)).status).toBe(status);
}

async function expectSingleDeletion(page, order, version) {
  const saved = await serviceCall(page, 'getPurchaseOrder', order.id);
  expect(saved.status).toBe('deleted');
  expect(saved.version).toBe(version);
  const activity = await serviceCall(page, 'listPurchaseOrderActivity', { query: order.number, limit: 25, offset: 0 });
  expect(activity.items.filter((event) => event.orderId === order.id && event.action === 'deleted')).toHaveLength(1);
  await expectRetryState(page, order, 'none');
}

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
  }, randomUUID());
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

  // Prepare version 2 with disposable service writes. The reviewed historical
  // prices must survive a later change to the linked product's current prices.
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
  const overview = await byService('getPurchaseOrderOverview');
  await page.getByRole('button', { name: 'All orders' }).click();
  await expect(page.getByTestId('text-po-open-count')).toHaveText(String(overview.openCount));
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

for (const entry of ['listing', 'detail']) {
  test(`${entry}: deletion identifies the order, traps focus and cancels without a request`, async ({ page }) => {
    const { order } = await loginAndSeed(page);
    const requests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/v1/admin/purchase-orders/${order.id}/delete`) requests.push(request);
    });
    const trigger = await openDeletion(page, order, entry);
    const dialog = deletionDialog(page, order);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const amount = await serviceCall(page, 'formatPaise', order.total);
    await expect(dialog).toHaveAccessibleDescription(new RegExp(`Version ${order.version}`));
    await expect(dialog.locator('#admin-dialog-description')).toContainText(order.vendorName);
    await expect(dialog.locator('#admin-dialog-description')).toContainText(amount);
    await expect(dialog).toContainText('receipts and stock are unchanged');
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    const cancel = dialog.getByTestId('button-cancel-confirmation');
    const confirm = dialog.getByTestId('button-confirm-action');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await deletionDialog(page, order).getByTestId('button-cancel-confirmation').click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(requests).toHaveLength(0);
    expect((await serviceCall(page, 'getPurchaseOrder', order.id)).version).toBe(order.version);
    await expectRetryState(page, order, 'none');
  });

  test(`${entry}: stale deletion loads changed identity and requires a separate reconfirmation`, async ({ page }) => {
    const { order, input } = await loginAndSeed(page);
    await openDeletion(page, order, entry);
    const dialog = deletionDialog(page, order);
    const changedInput = { ...input, lines: input.lines.map((line) => ({ ...line, quantity: '7' })) };
    const review = await serviceCall(page, 'previewPurchaseOrderEdit', order.id, changedInput);
    const updated = await serviceCall(page, 'updatePurchaseOrder', order.id, changedInput, order.version, review.reviewToken, randomUUID());
    const bodies = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/v1/admin/purchase-orders/${order.id}/delete`) bodies.push(request.postDataJSON());
    });
    await dialog.getByTestId('button-confirm-action').click();
    await expect(dialog.getByRole('alert')).toContainText('Load its latest version');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].expected_version).toBe(order.version);
    await expectRetryState(page, order, 'none');
    await dialog.getByRole('button', { name: 'Load latest order', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('confirm deletion again');
    await expect(dialog).toHaveAccessibleDescription(new RegExp(`Version ${updated.version}`));
    await expect(dialog.locator('#admin-dialog-description')).toContainText(await serviceCall(page, 'formatPaise', updated.total));
    expect(bodies).toHaveLength(1); // Loading must never send a second delete.
    expect((await serviceCall(page, 'getPurchaseOrder', order.id)).status).toBe('open');
    await dialog.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].expected_version).toBe(updated.version);
    expect(bodies[1].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
    await expectSingleDeletion(page, order, updated.version + 1);
    await expect(entry === 'listing' ? page.getByTestId('button-refresh-purchase-orders')
      : page.getByRole('button', { name: 'All orders', exact: true })).toBeFocused();
  });

  test(`${entry}: lost deletion response survives cancel and reload with the same request identity`, async ({ page }) => {
    const { order } = await loginAndSeed(page);
    await openDeletion(page, order, entry);
    const pattern = `**/api/v1/admin/purchase-orders/${order.id}/delete`;
    const bodies = [];
    let release;
    let committed;
    const held = new Promise((resolve) => { release = resolve; });
    const firstCommitted = new Promise((resolve) => { committed = resolve; });
    await page.route(pattern, async (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        const response = await route.fetch();
        committed(response.ok());
        await held;
        await route.abort('failed');
      } else await route.continue();
    });
    let dialog = deletionDialog(page, order);
    try {
      await dialog.getByTestId('button-confirm-action').click();
      expect(await firstCommitted).toBe(true); // Commit really happened before losing its response.
      await expect(dialog.getByTestId('button-confirm-action')).toBeDisabled();
      await expect(dialog.getByTestId('button-confirm-action')).toHaveText('Saving…');
      await expect(dialog.getByTestId('button-cancel-confirmation')).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(dialog).toBeVisible();
      expect(bodies).toHaveLength(1);
    } finally { release(); }
    await expect(dialog.getByRole('alert')).toContainText('Deletion is unconfirmed');
    const pending = (await serviceCall(page, 'loadOrderMutation', order.id)).pending;
    expect(pending.key).toBe(bodies[0].idempotencyKey);
    expect(pending.version).toBe(order.version);
    expect((await serviceCall(page, 'getPurchaseOrder', order.id)).status).toBe('deleted');
    await dialog.getByTestId('button-cancel-confirmation').click();
    await expect(dialog).toHaveCount(0);
    await expectRetryState(page, order, 'found');
    await page.reload();
    if (entry === 'listing') {
      // Default open listing no longer contains the committed deleted row.
      await expect(page.getByTestId('text-po-count')).toBeVisible();
      await expect(rowFor(page, order)).toHaveCount(0);
      const recovery = page.getByRole('button', { name: 'Review unconfirmed deletion 1', exact: true });
      await expect(recovery).toBeVisible();
      // A failed recovery GET must retain the journal and the same recovery action.
      const detailPattern = `**/api/v1/admin/purchase-orders/${order.id}`;
      await page.route(detailPattern, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Synthetic recovery outage"}' }), { times: 1 });
      await recovery.click();
      await expect(page.getByRole('status').filter({ hasText: 'Unable to load purchase orders. Check your connection and retry.' })).toBeVisible();
      await expectRetryState(page, order, 'found');
      expect(bodies).toHaveLength(1);
      await recovery.click();
    }
    dialog = deletionDialog(page, order);
    await expect(dialog.getByTestId('button-confirm-action')).toHaveText('Retry deletion');
    expect((await serviceCall(page, 'loadOrderMutation', order.id)).pending).toEqual(pending);
    await dialog.getByTestId('button-confirm-action').click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await page.unroute(pattern);
    await expectSingleDeletion(page, order, order.version + 1);
    if (entry === 'listing') {
      await expect(page.getByRole('button', { name: 'Review unconfirmed deletion 1', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('button-refresh-purchase-orders')).toBeFocused();
    } else {
      await expect(page.getByTestId('button-edit-po')).toHaveCount(0);
      await expect(page.getByTestId('button-delete-po')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'All orders', exact: true })).toBeFocused();
    }
  });
}

test('listing: direct Edit opens the editor; deletion preserves filters/page and refreshes overview', async ({ page }) => {
  const refs = await loginAndSeed(page);
  const orders = [refs.order];
  for (let index = 0; index < 4; index++) {
    const review = await serviceCall(page, 'previewPurchaseOrder', refs.input);
    orders.push(await serviceCall(page, 'createPurchaseOrder', refs.input, review.reviewToken, randomUUID()));
  }
  await page.goto(`${base()}${listingPath}`);
  await page.getByTestId('input-search-purchase-orders').fill(refs.vendor.vendorName);
  await expect(page.getByTestId('text-po-count')).toContainText('of 5 orders');
  const edit = rowFor(page, refs.order).getByRole('link', { name: `Edit ${refs.order.number}`, exact: true });
  await expect(edit).toHaveAttribute('href', `${listingPath}/${refs.order.id}?edit=1`);
  await edit.click();
  await expect(page).toHaveURL(`${detailUrlFor(refs.order)}?edit=1`);
  await expect(page.getByTestId('input-po-quantity-0')).toHaveValue('1');
  await expect(page.getByTestId('button-review-po')).toBeVisible();
  await expect(page.getByTestId('button-edit-po')).toHaveCount(0);

  await page.goto(`${base()}${listingPath}`);
  await page.getByTestId('input-search-purchase-orders').fill(refs.vendor.vendorName);
  await page.getByTestId('button-toggle-po-filters').click();
  await page.getByTestId('input-po-from').fill(refs.input.poDate);
  await page.getByTestId('input-po-to').fill(refs.input.poDate);
  await page.getByTestId('select-po-sort').selectOption('oldest');
  await page.getByRole('combobox', { name: 'Rows per page', exact: true }).selectOption('2');
  await expect(page.getByTestId('text-po-count')).toContainText('Showing 1–2 of 5 orders');
  await page.getByRole('button', { name: 'Go to page 2', exact: true }).click();
  await expect(page.getByTestId('text-po-count')).toContainText('Showing 3–4 of 5 orders');
  const number = await page.locator('.po-table .po-number').first().innerText();
  const order = orders.find((item) => item.number === number);
  expect(order).toBeTruthy();
  const before = await serviceCall(page, 'getPurchaseOrderOverview');
  await rowFor(page, order).getByRole('button', { name: `Delete ${number}`, exact: true }).click();
  await deletionDialog(page, order).getByTestId('button-confirm-action').click();
  await expect(deletionDialog(page, order)).toHaveCount(0);
  await expect(page.getByTestId('text-po-count')).toContainText('Showing 3–4 of 4 orders');
  await expect(page.getByRole('button', { name: 'Go to page 2', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('input-search-purchase-orders')).toHaveValue(refs.vendor.vendorName);
  await expect(page.getByTestId('select-po-status')).toHaveValue('open');
  await expect(page.getByTestId('input-po-from')).toHaveValue(refs.input.poDate);
  await expect(page.getByTestId('input-po-to')).toHaveValue(refs.input.poDate);
  await expect(page.getByTestId('select-po-sort')).toHaveValue('oldest');
  await expect(page.getByRole('combobox', { name: 'Rows per page', exact: true })).toHaveValue('2');
  await expect(rowFor(page, order)).toHaveCount(0);
  await expect(page.getByTestId('text-po-open-count')).toHaveText(String(before.openCount - 1));
  await expect(page.getByTestId('text-po-open-value')).toHaveText(await serviceCall(page, 'formatPaise', before.openValue - order.total));
  await expectSingleDeletion(page, order, order.version + 1);

  await page.getByTestId('select-po-status').selectOption('deleted');
  const deletedRow = rowFor(page, order);
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow.getByRole('link', { name: `View ${number}`, exact: true })).toBeVisible();
  await expect(deletedRow.getByRole('link', { name: `Edit ${number}`, exact: true })).toHaveCount(0);
  await expect(deletedRow.getByRole('button', { name: `Delete ${number}`, exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.locator('.po-mobile article').filter({ hasText: number });
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: `View ${number}`, exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: `Edit ${number}`, exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: `Delete ${number}`, exact: true })).toHaveCount(0);
  await page.goto(`${detailUrlFor(order)}?edit=1`);
  await expect(page.getByText(`Status: deleted · Version ${order.version + 1}`)).toBeVisible();
  await expect(page.getByTestId('input-po-quantity-0')).toHaveCount(0);
  await expect(page.getByTestId('button-edit-po')).toHaveCount(0);
  await expect(page.getByTestId('button-delete-po')).toHaveCount(0);
});

for (const failure of ['unreadable', 'corrupt', 'write-unavailable']) {
  test(`listing: ${failure} retry storage never sends a deletion or silently replaces its journal`, async ({ page }) => {
    const { order } = await loginAndSeed(page);
    const key = await page.evaluate(async (id) => {
      const { getSession } = await import('/src/auth/adminSession.js');
      return `evexia.po.pending-mutation:${getSession().user.id}:${id}`;
    }, order.id);
    const requests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/v1/admin/purchase-orders/${order.id}/delete`) requests.push(request);
    });
    if (failure === 'corrupt') {
      await page.evaluate((key) => localStorage.setItem(key, '{broken synthetic retry'), key);
    } else {
      await page.addInitScript(({ key, failure }) => {
        const method = failure === 'unreadable' ? 'getItem' : 'setItem';
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (name, ...args) {
          if (name === key) throw new DOMException('Synthetic retry storage unavailable', 'SecurityError');
          return original.call(this, name, ...args);
        };
      }, { key, failure });
    }
    await openDeletion(page, order, 'listing');
    const dialog = deletionDialog(page, order);
    if (failure === 'write-unavailable') {
      await dialog.getByTestId('button-confirm-action').click();
      await expect(dialog.getByRole('alert')).toContainText('Nothing was sent');
    } else {
      await expect(dialog.getByRole('alert')).toContainText('saved retry state cannot be read');
      await expect(dialog.getByTestId('button-confirm-action')).toBeDisabled();
    }
    await dialog.getByTestId('button-cancel-confirmation').click();
    await page.reload();
    await page.getByTestId('input-search-purchase-orders').fill(order.number);
    await rowFor(page, order).getByRole('button', { name: `Delete ${order.number}`, exact: true }).click();
    if (failure === 'write-unavailable') {
      await deletionDialog(page, order).getByTestId('button-confirm-action').click();
      await expect(deletionDialog(page, order).getByRole('alert')).toContainText('Nothing was sent');
    } else await expect(deletionDialog(page, order).getByTestId('button-confirm-action')).toBeDisabled();
    await deletionDialog(page, order).getByTestId('button-cancel-confirmation').click();
    await page.goto(detailUrlFor(order));
    if (failure !== 'write-unavailable') {
      await expect(page.getByRole('alert')).toContainText('saved retry state cannot be read');
      await expect(page.getByTestId('button-edit-po')).toBeDisabled();
      await expect(page.getByTestId('button-delete-po')).toBeDisabled();
    } else {
      await page.getByTestId('button-delete-po').click();
      await deletionDialog(page, order).getByTestId('button-confirm-action').click();
      await expect(deletionDialog(page, order).getByRole('alert')).toContainText('Nothing was sent');
    }
    expect(requests).toHaveLength(0);
    const saved = await serviceCall(page, 'getPurchaseOrder', order.id);
    expect(saved.status).toBe('open');
    expect(saved.version).toBe(order.version);
    if (failure === 'corrupt') {
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('{broken synthetic retry');
    }
    const activity = await serviceCall(page, 'listPurchaseOrderActivity', { query: order.number, limit: 25, offset: 0 });
    expect(activity.items.filter((event) => event.action === 'deleted')).toHaveLength(0);
  });
}
