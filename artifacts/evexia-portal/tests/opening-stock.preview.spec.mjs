import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') throw new Error('Opening Stock requires the disposable authenticated harness.');
const BASE = '/admin/masters/opening-stock';
const API = '/api/v1/admin/opening-stock';
const url = path => `${process.env.EVEXIA_PREVIEW_BASE_URL}${path}`;
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser exceptions').toEqual([]));

async function open(page) {
  await page.goto(url('/admin/login'));
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const refs = await page.evaluate(async () => {
    const s = await import('/src/auth/adminSession.js');
    const tag = crypto.randomUUID().slice(0, 8);
    const location = await s.locationRequest('', { body: { name: `Opening location ${tag}`, address: 'Synthetic laboratory', status: 'active' } });
    const category = await s.productCategoryRequest('', { body: { name: `Opening category ${tag}`, description: '', unit_price: '0', status: 'active' } });
    const allergen = await s.allergenRequest('', { body: {
      name: `Opening reagent ${tag}`, category_id: category.id, storage_location_id: location.id,
      selling_price: '90', gst: '12', concentration: '1:100', threshold_limit: null, mix: false, status: 'active',
    } });
    const second = await s.allergenRequest('', { body: {
      name: `Opening companion ${tag}`, category_id: category.id, storage_location_id: location.id,
      selling_price: '80', gst: '12', concentration: '1:100', threshold_limit: null, mix: false, status: 'active',
    } });
    const product = await s.productMasterRequest('', { body: {
      name: `Opening product ${tag}`, mrp: '100', sellingPrice: '90', status: 'active',
      members: [{ allergenId: allergen.id, quantity: '0.125' }, { allergenId: second.id, quantity: '0.250' }], idempotencyKey: crypto.randomUUID(),
    } });
    return { allergen, product, location };
  });
  await page.goto(url(BASE));
  await expect(page.getByTestId('text-opening-count')).toBeVisible();
  return refs;
}

async function choose(page, id, query, text) {
  const control = page.getByTestId(`select-${id}`);
  await control.fill(query);
  const option = page.getByRole('option').filter({ hasText: text });
  await expect(option).toBeVisible();
  await option.click();
  await control.press('Tab');
}
async function form(page, refs, { product = false, located = false } = {}) {
  await page.getByTestId('button-add-opening').click();
  await expect(page.getByTestId('input-opening-date')).toBeVisible();
  await page.getByTestId('select-os-item-0').fill('no-such-opening-choice');
  // A typed non-choice must never become a selected business identity.
  await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByTestId('select-os-item-0').press('Escape');
  const item = product ? refs.product : refs.allergen;
  await page.getByTestId('select-os-item-0').fill(item.name);
  const option = page.getByRole('option').filter({ hasText: item.id });
  await expect(option).toContainText(product ? '(Product,' : '(Allergen,');
  await option.click();
  await page.getByTestId('select-os-item-0').press('Tab');
  await expect(page.getByTestId('select-os-item-0')).toHaveValue(new RegExp(item.name));
  await page.getByTestId('input-opening-qty-0').fill(product ? '2' : '2.125');
  await page.getByTestId('input-opening-rate-0').fill('100.005');
  if (located) await choose(page, 'os-loc-0', refs.location.name, refs.location.name);
  else await expect(page.getByTestId('select-os-loc-0')).toHaveValue('Unallocated (no physical location)');
}
async function records(page, query) {
  return page.evaluate(async query => (await import('/src/services/openingStock.js')).listOpenings({ query, limit: 100 }), query);
}
async function cancelLeave(page, trigger, discard = false) {
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Leave this draft?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: discard ? 'Discard and leave' : 'Cancel', exact: true }).click();
}

async function renewal(page, id) {
  await page.evaluate(id => { window.openingDraftNode = document.querySelector(`[data-testid="${id}"]`); }, id);
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const handler = async route => { await gate; await route.continue(); };
  await page.route('**/api/v1/auth/refresh', handler);
  const renewing = page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  try {
    await expect(page.getByTestId('admin-session-content')).toBeHidden();
    await expect(page.getByTestId('admin-session-content')).toHaveAttribute('inert', '');
  } finally { resume(); }
  await renewing;
  await page.unroute('**/api/v1/auth/refresh', handler);
  await expect(page.getByTestId(id)).toBeVisible();
  const failure = route => route.abort();
  await page.route('**/api/v1/auth/refresh', failure);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId(id)).toBeHidden();
  await page.unroute('**/api/v1/auth/refresh', failure);
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(page.getByTestId(id)).toBeVisible();
  expect(await page.evaluate(id => window.openingDraftNode === document.querySelector(`[data-testid="${id}"]`), id)).toBe(true);
}

// Presentation measurements use the same real records; no API success stubs.
// Deliberately scrollable tables are checked separately from the page.
async function layout(page, label, root = '.move-stocks-page') {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const enlarged of [false, true]) {
      await page.evaluate(async enlarged => {
        const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
        setAdminPreference('theme', enlarged ? 'modern' : 'classic');
        setAdminPreference('appearance', enlarged ? 'dark' : 'light');
      }, enlarged);
      if (enlarged) {
        await page.evaluate(root => {
          const nodes = [...document.querySelector(root).querySelectorAll('*')];
          const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
          window.openingTextProbe = { node: nodes.find(node => node.matches('input, dd, p')), size: 0 };
          window.openingTextProbe.size = sizes[nodes.indexOf(window.openingTextProbe.node)];
          nodes.forEach((node, i) => {
            node.dataset.openingOriginalStyle = node.getAttribute('style') || '';
            node.style.setProperty('font-size', `${sizes[i] * 2}px`, 'important');
          });
        }, root);
        expect(await page.evaluate(() => parseFloat(getComputedStyle(window.openingTextProbe.node).fontSize) / window.openingTextProbe.size)).toBeCloseTo(2);
      }
      const geometry = await page.locator(root).evaluate(node => ({
        page: document.documentElement.scrollWidth, width: innerWidth,
        controls: [...node.querySelectorAll('button, input')].filter(n => n.getClientRects().length).map(n => {
          const r = n.getBoundingClientRect();
          const scroll = n.closest('.inv-scroll');
          const s = scroll?.getBoundingClientRect();
          const boundedScroll = scroll && ['auto', 'scroll'].includes(getComputedStyle(scroll).overflowX)
            && s.left >= -1 && s.right <= innerWidth + 1 && scroll.clientWidth > 0;
          return { name: n.getAttribute('data-testid') || n.textContent, left: r.left, right: r.right, width: r.width, content: n.scrollWidth, client: n.clientWidth, button: n.tagName === 'BUTTON', boundedScroll };
        }),
        tables: [...node.querySelectorAll('.inv-scroll')].map(n => ({ overflow: getComputedStyle(n).overflowX, width: n.clientWidth, scroll: n.scrollWidth })),
      }));
      expect(geometry.page, `${label} ${width} ${enlarged}: page overflow`).toBeLessThanOrEqual(geometry.width + 1);
      for (const c of geometry.controls) {
        expect(c.width).toBeGreaterThan(0);
        // Location-guide buttons live inside the deliberate table scroller.
        // Requiring every column on-screen simultaneously defeats that layout.
        if (!c.boundedScroll) {
          expect(c.left).toBeGreaterThanOrEqual(-1);
          expect(c.right, `${label} ${width} ${enlarged}: ${c.name}`).toBeLessThanOrEqual(width + 1);
        }
        if (c.button) expect(c.content, `${label}: clipped button text`).toBeLessThanOrEqual(c.client + 2);
      }
      for (const t of geometry.tables) if (t.scroll > t.width + 1) expect(['auto', 'scroll']).toContain(t.overflow);
      if (width === 390 && enlarged) await page.screenshot({ path: test.info().outputPath(`${label}-390-enlarged.png`), fullPage: true });
      if (enlarged) await page.locator(root).evaluate(node => {
        node.querySelectorAll('[data-opening-original-style]').forEach(n => {
          n.setAttribute('style', n.dataset.openingOriginalStyle); delete n.dataset.openingOriginalStyle;
        });
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function drawer(page, opener, kind) {
  // Explicit keyboard entry supplies focus-return evidence even on engines
  // which do not focus buttons after a mouse click.
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId(`drawer-${kind}-detail`);
  const close = page.getByTestId(`button-close-${kind}-detail`);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Server activity', { exact: true })).toBeVisible();
  await expect(close).toBeFocused();
  for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await layout(page, `${kind}-drawer`, `[data-testid="drawer-${kind}-detail"]`);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await expect(close).toBeVisible();
  await close.click();
  await expect(opener).toBeFocused();
}
async function download(page, id, filename) {
  const ready = page.waitForEvent('download');
  await page.getByTestId(id).click();
  const file = await ready;
  expect(file.suggestedFilename()).toBe(filename);
  expect(await file.failure()).toBeNull();
  const bytes = await readFile(await file.path());
  expect(bytes.length).toBeGreaterThan(30);
  if (filename.endsWith('.xlsx')) {
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    execFileSync('python3', ['-c', 'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert "xl/worksheets/sheet1.xml" in z.namelist()'], { input: bytes });
  }
  return bytes;
}
function csvRows(bytes) {
  return JSON.parse(execFileSync('python3', ['-c', 'import csv,sys,io,json; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().lstrip("\\ufeff"))))))'], { input: bytes, encoding: 'utf8' }));
}
function encodeCsv(rows) {
  return Buffer.from(rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n'));
}
async function interruptCommit(page, sendToServer) {
  let resolve, reject, result;
  const settled = new Promise((yes, no) => { resolve = yes; reject = no; });
  const handler = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      if (sendToServer) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        result = await response.json();
      }
      await route.abort();
      resolve();
    } catch (error) { reject(error); }
  };
  await page.route(`**${API}`, handler);
  return async () => {
    // The journal banner exists before the request finishes. Await the route
    // itself before removing interception, or Playwright can resume an
    // in-flight POST and turn a simulated lost reply into a real second send.
    await settled;
    await page.unroute(`**${API}`, handler);
    return result;
  };
}

test('manual review, cancellation, mounted renewal, lost committed reply, exact values and both drawers', async ({ page }) => {
  const refs = await open(page);
  await form(page, refs);
  await page.getByTestId('button-add-opening-row').click();
  await expect(page.getByTestId('row-opening-1')).toBeVisible();
  await page.getByTestId('button-remove-opening-1').click();
  await renewal(page, 'input-opening-qty-0');
  await expect(page.getByTestId('input-opening-qty-0')).toHaveValue('2.125');
  await expect(page.getByTestId('input-opening-rate-0')).toHaveValue('100.005');
  await layout(page, 'manual-form');
  await page.getByTestId('button-review-opening').click();
  const review = page.getByTestId('panel-opening-review');
  await expect(review).toContainText('INR 100.01');
  await expect(review).toContainText('INR 212.52125');
  expect((await records(page, refs.allergen.name)).filtered).toBe(0);
  await cancelLeave(page, page.getByRole('button', { name: 'Cancel', exact: true }));
  await expect(review).toBeVisible();
  await page.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.getByTestId('input-opening-qty-0')).toHaveValue('2.125');
  await page.getByTestId('button-review-opening').click();
  await layout(page, 'manual-review');
  const lostReply = await interruptCommit(page, true);
  await page.getByTestId('button-confirm-opening').click();
  const committed = await lostReply();
  await expect(page.getByTestId('button-check-opening-outcome')).toBeVisible();
  await expect(page.getByTestId('button-confirm-opening')).toHaveText('Confirm and save');
  await expect(page.getByTestId('button-confirm-opening')).toBeDisabled();
  await page.getByTestId('button-check-opening-outcome').click();
  await expect(page.getByTestId('text-opening-count')).toBeVisible();
  expect((await records(page, refs.allergen.name)).filtered).toBe(1);
  const record = committed.records[0];
  expect(record).toMatchObject({ quantity: '2.125', unitRate: '100.01', openingValue: '212.52125' });
  await page.getByTestId('input-search-opening').fill(refs.allergen.name);
  await expect(page.getByTestId(`row-opening-${record.id}`)).toContainText('INR 212.52125');
  await drawer(page, page.getByTestId(`button-view-opening-${record.id}`), 'opening');
  for (const format of ['csv', 'xlsx']) {
    const bytes = await download(page, `button-export-opening-${format}`, `opening-stock.${format}`);
    if (format === 'csv') expect(csvRows(bytes)[1][7]).toBe('100.01');
  }
  const movement = await page.evaluate(async ({ record, location }) => {
    const { inventoryRequest } = await import('/src/auth/adminSession.js');
    const body = { sourceId: null, destinationId: location.id, date: record.recordedDate, deliveryMode: 'other',
      staffId: null, otherName: 'Synthetic carrier', lines: [{ lotId: record.lotId, quantity: '1.125' }] };
    const review = await inventoryRequest('/movements/preview', { body });
    return inventoryRequest('/movements', { body: { ...body, reviewToken: review.reviewToken, idempotencyKey: crypto.randomUUID() } });
  }, { record, location: refs.location });
  await page.goto(url('/admin/inventory/move-stocks'));
  await expect(page.getByTestId('text-move-count')).toBeVisible();
  await drawer(page, page.getByTestId(`button-view-move-${movement.id}`), 'move');
});

test('typed products, optional location, rejected quantity, cancelled review and not-committed reconciliation', async ({ page }) => {
  const refs = await open(page);
  await form(page, refs, { product: true, located: true });
  await page.getByTestId('input-opening-qty-0').fill('1.125');
  await page.getByTestId('button-review-opening').click();
  await expect(page.getByRole('alert')).toContainText('whole number');
  await page.getByTestId('input-opening-qty-0').fill('2');
  await page.getByTestId('input-opening-rate-0').fill('999999999999.994999');
  await page.getByTestId('button-review-opening').click();
  await expect(page.getByTestId('panel-opening-review')).toContainText('INR 9,99,99,99,99,999.99');
  const notSent = await interruptCommit(page, false);
  await page.getByTestId('button-confirm-opening').click();
  await notSent();
  await expect(page.getByTestId('button-check-opening-outcome')).toBeVisible();
  await expect(page.getByTestId('button-confirm-opening')).toHaveText('Confirm and save');
  await page.getByTestId('button-check-opening-outcome').click();
  await expect(page.getByTestId('panel-opening-review')).toHaveCount(0);
  await expect(page.getByTestId('input-opening-qty-0')).toHaveValue('2');
  await expect(page.getByTestId('select-os-loc-0')).toHaveValue(refs.location.name);
  expect((await records(page, refs.product.name)).filtered).toBe(0);
  await page.getByTestId('button-review-opening').click();
  await cancelLeave(page, page.getByRole('button', { name: 'Cancel', exact: true }), true);
  await expect(page.getByTestId('text-opening-count')).toBeVisible();
  expect((await records(page, refs.product.name)).filtered).toBe(0);
});

test('CSV/XLSX downloads, import validation, review cancellation, renewal and export re-import reconciliation', async ({ page }) => {
  const refs = await open(page);
  await page.getByTestId('button-import-opening').click();
  await expect(page.getByTestId('input-opening-file')).toBeVisible();
  const csv = await download(page, 'button-sample-csv', 'opening-stock-sample.csv');
  await download(page, 'button-sample-xlsx', 'opening-stock-sample.xlsx');
  const all = csvRows(csv);
  const row = all.find(row => row[3] === refs.allergen.id);
  expect(row).toBeTruthy();
  const untouched = encodeCsv([all[0], row]);
  const file = page.getByTestId('input-opening-file');
  await file.setInputFiles({ name: 'untouched.csv', mimeType: 'text/csv', buffer: untouched });
  await page.getByTestId('button-review-import').click();
  await expect(page.getByTestId('panel-import-review')).toContainText('1 skipped');
  await expect(page.getByTestId('button-commit-import')).toBeDisabled();
  row[6] = '2.125';
  row[7] = '';
  await file.setInputFiles({ name: 'partial.csv', mimeType: 'text/csv', buffer: encodeCsv([all[0], row]) });
  await page.getByTestId('button-review-import').click();
  await expect(page.getByTestId('panel-import-review')).toContainText('1 with errors');
  await expect(page.getByTestId('button-commit-import')).toBeDisabled();
  row[7] = '100.005';
  row[8] = ''; row[9] = '';
  await file.setInputFiles({ name: 'filled.csv', mimeType: 'text/csv', buffer: encodeCsv([all[0], row]) });
  await page.getByTestId('button-review-import').click();
  await expect(page.getByTestId('panel-import-review')).toContainText('1 ready');
  await expect(page.getByTestId('panel-import-review')).toContainText('INR 212.52125');
  await expect(page.getByTestId('panel-import-review')).toContainText('Unallocated');
  await renewal(page, 'input-opening-file');
  expect(await file.evaluate(node => node.files[0].name)).toBe('filled.csv');
  await cancelLeave(page, page.getByRole('button', { name: 'All opening stock', exact: true }));
  await expect(page.getByTestId('panel-import-review')).toBeVisible();
  expect((await records(page, refs.allergen.name)).filtered).toBe(0);
  await layout(page, 'import-review');
  const lostImport = await interruptCommit(page, true);
  await page.getByTestId('button-commit-import').click();
  await lostImport();
  await expect(page.getByTestId('button-commit-import')).toHaveText('Confirm and import');
  await expect(page.getByTestId('button-commit-import')).toBeDisabled();
  await expect(page.getByTestId('panel-import-review')).toBeVisible();
  expect(await file.evaluate(node => node.files[0].name)).toBe('filled.csv');
  await page.getByTestId('button-check-opening-outcome').click();
  await expect(page.getByTestId('panel-import-result')).toContainText('1 new record posted');
  await page.getByRole('button', { name: 'View opening stock', exact: true }).click();
  await expect(page.getByTestId('text-opening-count')).toBeVisible();
  await page.getByTestId('input-search-opening').fill(refs.allergen.name);
  const backup = await download(page, 'button-export-opening-xlsx', 'opening-stock.xlsx');
  await page.getByTestId('button-import-opening').click();
  await file.setInputFiles({ name: 'backup.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: backup });
  await page.getByTestId('button-review-import').click();
  await expect(page.getByTestId('text-already-imported')).toContainText('1 row is already imported');
  await page.getByTestId('button-commit-import').click();
  await expect(page.getByTestId('panel-import-result')).toContainText('0 new records posted, 1 already imported');
  expect((await records(page, refs.allergen.name)).filtered).toBe(1);
  // Accepting the leave confirmation must discard an uncommitted import,
  // unlike the earlier cancelled navigation, without posting another row.
  await file.setInputFiles({ name: 'discard.csv', mimeType: 'text/csv', buffer: encodeCsv([all[0], row]) });
  await page.getByTestId('button-review-import').click();
  await expect(page.getByTestId('panel-import-review')).toBeVisible();
  await cancelLeave(page, page.getByRole('button', { name: 'All opening stock', exact: true }), true);
  await expect(page.getByTestId('text-opening-count')).toBeVisible();
  expect((await records(page, refs.allergen.name)).filtered).toBe(1);
});
