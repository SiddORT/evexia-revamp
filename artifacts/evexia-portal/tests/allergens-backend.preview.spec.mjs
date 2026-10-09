import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const legacy = '[{"id":"local-only","name":"Untouched browser allergen"}]';
const visibleId = (page, id) => page.locator(`[data-testid="${id}"]:visible`);
async function open(page, path = '/admin/masters/allergens') {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(async () => {
    const { listProductCategories, createProductCategory } = await import('/src/services/serverProductCategories.js');
    const { listLocations, createLocation } = await import('/src/services/serverLocations.js');
    if (!(await listProductCategories({ status: 'active', limit: 1, offset: 0 })).items.length) {
      await createProductCategory({ name: 'Synthetic allergen category', description: '', unit_price: '0', status: 'active' });
    }
    if (!(await listLocations({ status: 'active', limit: 1, offset: 0 })).items.length) {
      await createLocation({ name: 'Synthetic allergen location', address: 'Test laboratory', status: 'active' });
    }
  });
  await page.evaluate((legacy) => localStorage.setItem('evexia.admin.allergens.v1', legacy), legacy);
  await page.goto(`${base()}${path}`);
  if (path === '/admin/masters/allergens') await expect(page.getByTestId('text-allergen-count')).toBeVisible();
}
async function pick(page, testId, name) {
  const select = page.getByTestId(testId);
  await select.click();
  const menu = page.getByRole('listbox', { name: await select.getAttribute('aria-label'), exact: true });
  const option = name ? menu.getByRole('option', { name, exact: true }) : menu.getByRole('option').nth(1);
  await expect(option).toBeVisible();
  await option.click();
  await expect(select).toHaveAttribute('aria-expanded', 'false');
}
for (const [label, viewport, scheme] of [['desktop light', { width: 1280, height: 800 }, 'light'], ['mobile dark', { width: 390, height: 844 }, 'dark']]) {
  test(`allergen ${label}: keyboard switch, persistence, concurrency, filters and delete`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.evaluate(async (scheme) => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('appearance', scheme);
      setAdminPreference('theme', scheme === 'dark' ? 'modern' : 'classic');
    }, scheme);
    await expect(page.getByText('Untouched browser allergen')).toHaveCount(0);
    await page.getByTestId('button-add-allergen').click();
    await expect(page.getByText('Drafts stay in memory during same-identity renewal. A failed save keeps your draft; use Cancel to discard it.')).toHaveCount(0);
    await expect(page.locator('.mr-form__footer-note')).toHaveCount(0);
    const name = `Synthetic allergen ${label} ${Date.now()}`;
    await expect(page.getByLabel('HSN', { exact: false })).toHaveCount(0);
    await page.getByTestId('button-save-allergen').click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByTestId('select-allergen-category')).toHaveAttribute('aria-describedby', 'allergen-category_id-error');
    await expect(page.getByTestId('select-allergen-location')).toHaveAttribute('aria-describedby', 'allergen-storage_location_id-error');
    await page.getByTestId('input-allergen-name').fill(name);
    await pick(page, 'select-allergen-category');
    await pick(page, 'select-allergen-location');
    await page.getByTestId('input-allergen-selling_price').fill('0.1234567');
    await page.getByTestId('button-save-allergen').click();
    await expect(page.getByTestId('input-allergen-selling_price')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('input-allergen-selling_price').fill('12.345678');
    await page.getByTestId('input-allergen-gst').fill('12.5');
    await page.getByTestId('input-allergen-concentration').fill('1:100 w/v');
    const mix = page.getByTestId('switch-allergen-mix');
    await expect(mix).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('text-allergen-mix-state')).toHaveText('No Mix');
    await page.getByTestId('select-allergen-status').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(mix).toBeFocused();
    await page.keyboard.press('Space');
    await expect(mix).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('text-allergen-mix-state')).toHaveText('Mix');
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/allergens' && r.request().method() === 'POST');
    let releaseSave;
    const heldSave = new Promise(resolve => { releaseSave = resolve; });
    await page.route('**/api/v1/admin/allergens', async route => {
      if (route.request().method() === 'POST') await heldSave;
      await route.continue();
    });
    await page.getByTestId('button-save-allergen').click();
    for (const id of ['select-allergen-category', 'select-allergen-location', 'select-allergen-status', 'switch-allergen-mix', 'button-cancel-allergen', 'button-save-allergen']) await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    releaseSave();
    const row = await (await created).json();
    await page.unroute('**/api/v1/admin/allergens');
    expect(row.mix).toBe(true);
    expect(row.selling_price).toBe('12.345678');
    await expect(visibleId(page, `text-allergen-name-${row.id}`)).toBeVisible();
    // Filters: exact bounds, invalid bounds, clear.
    await page.getByTestId('input-search-allergens').fill(name);
    await pick(page, 'select-filter-status', 'Active');
    await pick(page, 'select-filter-category', row.category_name);
    await pick(page, 'select-filter-location', row.storage_location_name);
    await pick(page, 'select-filter-mix', 'No Mix');
    await expect(page.getByTestId(`text-allergen-name-${row.id}`)).toHaveCount(0);
    await pick(page, 'select-filter-mix', 'Mix');
    await page.getByTestId('input-min-price').fill('12.345678');
    await page.getByTestId('input-max-price').fill('12.345677');
    await expect(page.getByRole('alert').filter({ hasText: 'Maximum price' })).toBeVisible();
    await page.getByTestId('input-max-price').fill('12.345678');
    await expect(visibleId(page, `text-allergen-name-${row.id}`)).toBeVisible();
    for (const format of ['csv', 'xlsx']) {
      const response = page.waitForResponse(r => r.url().includes('/allergens/export?'));
      const download = page.waitForEvent('download');
      await page.getByTestId('button-export-allergens').click();
      await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
      const params = new URL((await response).url()).searchParams;
      expect(Object.fromEntries(params)).toMatchObject({ query: name, status: 'active', category_id: row.category_id, storage_location_id: row.storage_location_id, mix: 'mix', min_price: '12.345678', max_price: '12.345678', format });
      expect((await readFile(await (await download).path())).length).toBeGreaterThan(0);
    }
    await page.getByTestId('button-clear-filters').click();
    await expect(page.getByTestId('input-search-allergens')).toHaveValue('');
    // Concurrency: stale edit is blocked and draft kept.
    await page.getByTestId('input-search-allergens').fill(name);
    await visibleId(page, `button-edit-allergen-${row.id}`).click();
    await expect(page.getByTestId('input-allergen-name')).toHaveValue(name);
    await page.getByTestId('input-allergen-concentration').fill('stale draft');
    // Same-route authenticated renewal must retain the mounted input node.
    await page.evaluate(async () => {
      window.__allergenDraftInput = document.querySelector('[data-testid="input-allergen-concentration"]');
      const { verifySession } = await import('/src/auth/adminSession.js');
      await verifySession(true);
    });
    await expect(page.getByTestId('input-allergen-concentration')).toHaveValue('stale draft');
    expect(await page.evaluate(() => window.__allergenDraftInput === document.querySelector('[data-testid="input-allergen-concentration"]'))).toBe(true);
    await page.evaluate(async (row) => {
      const { editAllergen } = await import('/src/services/serverAllergens.js');
      await editAllergen(row, { name: row.name, category_id: row.category_id, storage_location_id: row.storage_location_id, selling_price: row.selling_price, gst: row.gst, concentration: 'concurrent', threshold_limit: row.threshold_limit, status: row.status, mix: row.mix });
    }, row);
    await page.getByTestId('button-save-allergen').click();
    await expect(page.getByTestId('button-reconcile-allergen')).toBeVisible();
    await expect(page.getByTestId('button-save-allergen')).toBeDisabled();
    await expect(page.getByTestId('input-allergen-concentration')).toHaveValue('stale draft');
    await page.getByTestId('button-reconcile-allergen').click();
    await expect(page.getByRole('alert').first()).toContainText('concurrent');
    await page.getByTestId('button-cancel-allergen').click();
    // Export menu is keyboard operable and returns focus.
    const exportButton = page.getByTestId('button-export-allergens');
    // Cancel returns to a newly mounted list whose export action is initially
    // disabled while its page loads. A disabled button cannot receive focus.
    await expect(exportButton).toBeEnabled();
    await exportButton.focus();
    await expect(exportButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'CSV' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exportButton).toBeFocused();
    // Status actions use the current server version and shared confirmation.
    await page.getByTestId('input-search-allergens').fill(name);
    for (const next of ['inactive', 'active']) {
      await visibleId(page, `button-status-allergen-${row.id}`).click();
      const response = page.waitForResponse(r => r.url().includes(`/allergens/${row.id}/status`));
      await page.getByTestId('button-confirm-action').click();
      expect((await (await response).json()).status).toBe(next);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(visibleId(page, `text-allergen-name-${row.id}`)).toBeVisible();
    }
    // Soft delete.
    await page.getByTestId('input-search-allergens').fill(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`allergen-${label.replace(' ', '-')}.png`), fullPage: true });
    await visibleId(page, `button-delete-allergen-${row.id}`).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete product' }).click();
    await expect(page.getByTestId(`text-allergen-name-${row.id}`)).toHaveCount(0);
    await expect(page.getByText('Untouched browser allergen')).toHaveCount(0);
  });
}
test('allergen import route has two prepared cards, selected tab and a review that saves nothing', async ({ page }) => {
  await open(page, '/admin/masters/import/allergen');
  await expect(page.getByRole('heading', { name: 'Import Allergen data' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Select a master for import' }).getByRole('button', { name: 'Allergen Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.excel-import__card')).toHaveCount(2);
  const csv = 'Product Name,Category,Selling Price,GST,Storage Location,Concentration,Threshold limit,Status,Mix / No Mix\nImport probe,Missing category,1,5,Missing location,1:10,,active,Mix\n';
  await page.getByTestId('input-allergen-import').setInputFiles({ name: 'probe.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Upload & review' }).click();
  await expect(page.getByTestId('allergen-excel-report')).toBeVisible();
  await expect(page.getByTestId('button-confirm-allergen-import')).toBeDisabled();
  await page.getByTestId('input-allergen-import').setInputFiles({ name: 'other.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('allergen-excel-report')).toHaveCount(0);
});

test('allergen CSV/Excel filtered downloads, review-confirm round trips and explicit legacy CSV', async ({ page }) => {
  await open(page);
  const unique = `Transfer ${Date.now()}`;
  const created = await page.evaluate(async (name) => {
    const { createAllergen, listAllergenReferences } = await import('/src/services/serverAllergens.js');
    const category = (await listAllergenReferences('categories', {})).items[0];
    const location = (await listAllergenReferences('locations', {})).items[0];
    return createAllergen({ name, category_id: category.id, storage_location_id: location.id,
      selling_price: '999999999999.999999', gst: '99.123456', concentration: '5 mg/mL',
      threshold_limit: '0.000001', status: 'active', mix: false });
  }, unique);
  await page.getByTestId('input-search-allergens').fill(unique);
  await expect(visibleId(page, `text-allergen-name-${created.id}`)).toBeVisible();
  const other = await page.context().newPage();
  await other.goto(`${base()}/admin/masters/allergens`);
  await other.getByTestId('input-search-allergens').fill(unique);
  await expect(visibleId(other, `text-allergen-name-${created.id}`)).toBeVisible();
  await other.close();
  let current = created;
  for (const format of ['csv', 'xlsx']) {
    const event = page.waitForEvent('download');
    await page.getByTestId('button-export-allergens').click();
    await page.getByRole('menuitem', { name: format === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const download = await event;
    const bytes = await readFile(await download.path());
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    if (format === 'csv') {
      expect(bytes.toString('utf8')).toContain('999999999999.999999');
      expect(bytes.toString('utf8')).not.toContain('HSN');
    } else {
      const rows = JSON.parse(execFileSync('python3', ['-c', 'import io,json,sys,openpyxl;print(json.dumps(list(openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()),read_only=True).active.values)))'], { input: bytes, encoding: 'utf8' }));
      expect(rows).toHaveLength(2);
      expect(rows[1][2]).toBe('999999999999.999999');
      expect(rows[1][8]).toBe('No Mix');
    }
    await expect(page.getByTestId('button-export-allergens')).toBeFocused();
    await visibleId(page, `button-delete-allergen-${current.id}`).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`text-allergen-name-${current.id}`)).toHaveCount(0);
    await page.getByTestId('button-import-allergens').click();
    await page.getByTestId('input-allergen-import').setInputFiles({ name: `backup.${format}`, mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await expect(page.getByTestId('allergen-excel-report')).toContainText('All rows valid');
    const imported = page.waitForResponse(r => r.url().includes('/admin/allergens/import/commit'));
    await page.getByTestId('button-confirm-allergen-import').click();
    expect((await imported).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: '1 allergen products imported' })).toBeVisible();
    await page.locator('.excel-import__back').click();
    await expect(page.getByTestId('text-allergen-count')).toBeVisible();
    await page.getByTestId('input-search-allergens').fill(unique);
    current = await page.evaluate(async (name) => {
      const { listAllergens } = await import('/src/services/serverAllergens.js');
      return (await listAllergens({ query: name, status: 'all', limit: 10, offset: 0 })).items[0];
    }, unique);
    expect(current.id).not.toBe(created.id);
    expect(current.mix).toBe(false);
    await expect(visibleId(page, `text-allergen-name-${current.id}`)).toBeVisible();
  }
  await page.getByTestId('button-import-allergens').click();
  for (const format of ['csv', 'xlsx']) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: format === 'csv' ? 'Download CSV sample' : 'Download Excel sample', exact: true }).click();
    const bytes = await readFile(await (await event).path());
    if (format === 'csv') expect(bytes.toString('utf8')).toContain('Mix / No Mix');
    else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  const legacyName = unique + ' legacy';
  const legacyCsv = `Product Name,Category,Selling Price,GST,Storage Location,Concentration,Threshold limit,HSN code,Status,Allergens / No Mix\n${legacyName},${current.category_name},,0,${current.storage_location_name},1:10,,3822,active,Allergens\n`;
  await page.getByTestId('input-allergen-import').setInputFiles({ name: 'legacy.csv', mimeType: 'text/csv', buffer: Buffer.from(legacyCsv) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('allergen-excel-report')).toContainText('All rows valid');
  await page.getByTestId('button-confirm-allergen-import').click();
  await expect(page.getByRole('status').filter({ hasText: '1 allergen products imported' })).toBeVisible();
  const legacyRow = await page.evaluate(async (name) => {
    const { listAllergens } = await import('/src/services/serverAllergens.js');
    return (await listAllergens({ query: name, status: 'all', limit: 10, offset: 0 })).items[0];
  }, legacyName);
  expect(legacyRow.mix).toBe(true);
  expect(legacyRow.selling_price).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.allergens.v1'))).toBe(legacy);
});

test('allergen unchanged inactive/deleted references remain identifiable, new selections fail at save', async ({ page }) => {
  await open(page);
  const row = await page.evaluate(async (suffix) => {
    const { createProductCategory, statusProductCategory } = await import('/src/services/serverProductCategories.js');
    const { createLocation, deleteLocation } = await import('/src/services/serverLocations.js');
    const { createAllergen } = await import('/src/services/serverAllergens.js');
    const c = await createProductCategory({ name: `Retained category ${suffix}`, description: '', unit_price: '0', status: 'active' });
    const l = await createLocation({ name: `Retained location ${suffix}`, address: 'Lab', status: 'active' });
    const a = await createAllergen({ name: `Retained reagent ${suffix}`, category_id: c.id, storage_location_id: l.id,
      selling_price: null, gst: '0', concentration: '1:10', threshold_limit: null, status: 'active', mix: true });
    await statusProductCategory(c, 'inactive');
    await deleteLocation(l);
    return a;
  }, Date.now());
  await page.goto(`${base()}/admin/masters/allergens/${row.id}`);
  await expect(page.getByTestId('select-allergen-category')).toContainText('(inactive)');
  await expect(page.getByTestId('select-allergen-location')).toContainText('(deleted)');
  await page.getByTestId('select-allergen-category').click();
  await page.getByTestId('select-allergen-category-search').fill('no such retained category');
  await expect(page.getByRole('status').filter({ hasText: 'No matching product category.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('select-allergen-category')).toContainText('(inactive)');
  await page.getByTestId('input-allergen-concentration').fill('Retained specification');
  await page.getByTestId('switch-allergen-mix').click();
  await page.getByTestId('button-save-allergen').click();
  await expect(page).toHaveURL(/\/admin\/masters\/allergens(?:\?saved=updated)?$/);
  await page.getByTestId('input-search-allergens').fill(row.name);
  await expect(visibleId(page, `text-allergen-name-${row.id}`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('allergen-retained-references.png'), fullPage: true });
});

test('allergen combined references: bounded pages, late searches, retry, keyboard, labels and cold layouts', async ({ page }) => {
  const refs = Array.from({ length: 28 }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-aaaa-${String(index + 1).padStart(12, '0')}`,
    name: index === 27 ? `Last page ${'long readable category name '.repeat(6)}` : `Picker category ${String(index + 1).padStart(2, '0')}`,
    status: index === 26 ? 'inactive' : 'active',
  }));
  const queries = [];
  let retryFails = true;
  let releaseOld;
  const old = new Promise(resolve => { releaseOld = resolve; });
  let oldStarted;
  const started = new Promise(resolve => { oldStarted = resolve; });
  await page.route('**/api/v1/admin/allergens/references/categories?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get('query') || '';
    queries.push(Object.fromEntries(params));
    expect(params.get('limit')).toBe('25');
    if (query === 'old') { oldStarted(); await old; }
    if (query === 'retry' && retryFails) {
      retryFails = false;
      await route.fulfill({ status: 503, json: { error: { message: 'Synthetic reference unavailable' } } });
      return;
    }
    let matches = query === 'old' ? [{ ...refs[0], name: 'Stale search response' }]
      : query === 'retry' ? [refs[1]] : refs.filter(ref => ref.name.toLowerCase().includes(query.toLowerCase()));
    if (params.get('include_unusable') !== 'true') matches = matches.filter(ref => ref.status === 'active');
    const offset = Number(params.get('offset'));
    await route.fulfill({ json: { items: matches.slice(offset, offset + 25), total: matches.length, limit: 25, offset } });
  });
  await open(page);
  const category = page.getByTestId('select-filter-category');
  await expect(page.getByTestId('select-filter-category-search')).toHaveCount(0);
  await category.focus();
  await page.keyboard.press('ArrowDown');
  const search = page.getByTestId('select-filter-category-search');
  await expect(search).toBeFocused();
  await expect(page.getByTestId('select-filter-category-more')).toBeVisible();
  await page.getByTestId('select-filter-category-more').click();
  await expect(page.getByRole('option', { name: refs[27].name, exact: true })).toBeVisible();
  await page.getByRole('option', { name: refs[27].name, exact: true }).click();
  await expect(category).toContainText(refs[27].name);
  await category.click();
  await search.fill('Picker category 02');
  await expect(page.getByRole('option', { name: refs[1].name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(category).toBeFocused();
  await expect(category).toContainText(refs[27].name);
  await category.click();
  await search.fill('old');
  await started;
  await search.fill('Picker category 03');
  await expect(page.getByRole('option', { name: refs[2].name, exact: true })).toBeVisible();
  releaseOld();
  await expect(page.getByRole('option', { name: 'Stale search response' })).toHaveCount(0);
  await search.fill('retry');
  await expect(page.getByRole('alert').filter({ hasText: 'Allergen service is unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('option', { name: refs[1].name, exact: true })).toBeVisible();
  await search.fill('nothing matches');
  await expect(page.getByRole('status').filter({ hasText: 'No matching product category.' })).toBeVisible();
  await search.fill('Picker category 03');
  await expect(page.getByRole('option', { name: refs[2].name, exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown'); // first option is the explicit reset choice
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(category).toContainText(refs[2].name);
  await page.getByRole('button', { name: 'Clear product category', exact: true }).click();
  await expect(category).toContainText('All categories');
  await category.click();
  await search.fill('Last page');
  await expect(page.getByRole('option', { name: refs[27].name, exact: true })).toBeVisible();
  await page.getByRole('option', { name: refs[27].name, exact: true }).click();
  for (const [width, appearance] of [[1280, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(async appearance => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('appearance', appearance);
    }, appearance);
    await category.click();
    await expect(page.getByRole('option', { name: refs[27].name, exact: true })).toBeVisible();
    const geometry = await page.locator('.admin-allergen-combobox__menu').evaluate(menu => {
      const box = menu.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, scroll: getComputedStyle(menu).overflowY, width: innerWidth, viewportHeight: innerHeight };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.height).toBeLessThanOrEqual(302);
    expect(geometry.scroll).toBe('auto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`allergen-picker-${width}-${appearance}.png`), fullPage: true });
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('button-clear-filters').click();
  await expect(category).toContainText('All categories');
  await expect(page.getByTestId('select-filter-status')).toContainText('All statuses');
  await expect(page.getByTestId('select-filter-mix')).toContainText('All');
  expect(queries.some(query => query.offset === '25')).toBe(true);
  expect(queries.every(query => query.include_unusable === 'true')).toBe(true);
  // A cold direct Add visit uses active-only search and does not expose the saved filter.
  await page.goto(`${base()}/admin/masters/allergens/new`);
  await expect(page.getByTestId('select-allergen-category')).toBeVisible();
  await page.getByTestId('select-allergen-category').click();
  await page.getByTestId('select-allergen-category-search').fill('Picker category 27');
  await expect(page.getByRole('status').filter({ hasText: 'No matching product category.' })).toBeVisible();
  expect(queries.at(-1).include_unusable).toBe('false');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('select-allergen-category')).toContainText('Select product category');
  await page.getByTestId('select-allergen-status').click();
  await page.getByTestId('select-allergen-status-search').fill('missing');
  await expect(page.getByRole('status').filter({ hasText: 'No matching status.' })).toBeVisible();
  await page.getByTestId('select-allergen-status-search').fill('Inactive');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('select-allergen-status')).toContainText('Inactive');
  for (const [width, appearance] of [[1280, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(async appearance => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('appearance', appearance);
    }, appearance);
    await expect(page.getByTestId('button-save-allergen')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`allergen-form-${width}-${appearance}.png`), fullPage: true });
  }
});
