import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const header = 'Employee Code,Start Year,End Year,Q1,Q2,Q3,Q4,Status';
const storageKey = 'evexia.admin.sales-targets.v1';
const legacy = '[{"id":"untouched-local-target","mrId":"local-only","q1":999}]';
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(({ storageKey, legacy }) => localStorage.setItem(storageKey, legacy), { storageKey, legacy });
  const refs = await page.evaluate(async (tag) => {
    const session = await import('/src/auth/adminSession.js');
    const hq = await session.headquarterRequest('', { body: { name: `Target HQ ${tag}`, status: 'active' } });
    const zone = await session.zoneRequest('', { body: { name: `Target Zone ${tag}`, status: 'active' } });
    const otherZone = await session.zoneRequest('', { body: { name: `Other Target Zone ${tag}`, status: 'active' } });
    const created = await session.mrRequest('', { body: {
      name: `Target MR ${tag}`, employeeCode: `TARGET-${tag}`, userId: `target.${tag}`,
      phone: '', email: '', contactRequirement: 'optional', hq: hq.id, zoneId: zone.id,
      dateOfJoining: '2020-01-01', designation: 'Synthetic MR', reportingManagerId: null,
      paymentLimit: '', doctorDaysLimit: '', status: 'active', pincode: '110001',
      addressLine1: 'Synthetic address', addressLine2: '', landmark: 'Synthetic landmark', city: 'Delhi', state: 'Delhi', country: 'India',
    } });
    return { mr: created.record, hq, zone, otherZone };
  }, tag());
  await page.goto(`${base()}/admin/masters/sales-targets`);
  await expect(page.getByTestId('text-sales-target-count')).toBeVisible();
  return refs;
}

async function choose(page, id, query, optionName) {
  const control = page.getByTestId(`select-${id}`);
  await control.fill(query);
  await page.getByRole('option', { name: optionName, exact: true }).click();
  await control.press('Tab');
}

async function create(page, refs) {
  await page.getByTestId('button-add-sales-target').click();
  await choose(page, 'sales-target-mr', refs.mr.employeeCode, `${refs.mr.name} (${refs.mr.employeeCode})`);
  await expect(page.getByTestId('input-sales-target-zone')).toHaveValue(refs.zone.name);
  await expect(page.getByTestId('input-sales-target-headquarter')).toHaveValue(refs.hq.name);
  await page.getByTestId('input-sales-target-q1').fill('999999999999.99');
  for (const key of ['q2', 'q3', 'q4']) await page.getByTestId(`input-sales-target-${key}`).fill('0.01');
  await expect(page.getByTestId('text-sales-target-annual')).toHaveText('₹10,00,00,00,00,000.02');
  const years = page.getByTestId('select-sales-target-startYear');
  const current = await years.inputValue();
  await years.fill('not-a-year');
  await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
  await years.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(years).toHaveValue(current);
  await expect(page.getByTestId('input-sales-target-q1')).toHaveValue('999999999999.99');
  await years.click();
  await years.fill(current);
  await expect(page.getByRole('option', { name: current, exact: true })).toBeVisible();
  await years.press('ArrowDown');
  await years.press('Enter');
  await years.press('Tab');
  await expect(page.getByTestId('select-sales-target-endYear')).toHaveValue(String(Number(current) + 1));
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/sales-targets' && r.request().method() === 'POST');
  await page.getByTestId('button-save-sales-target').click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const row = await response.json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return row;
}

for (const mobile of [false, true]) {
  test(`sales targets ${mobile ? 'mobile Modern dark' : 'desktop Classic light'} exact CRUD, searchable years, stale edits and confirmed actions`, async ({ page, context }) => {
    test.setTimeout(150000);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    const refs = await open(page);
    if (mobile) await page.evaluate(async () => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('theme', 'modern');
      setAdminPreference('appearance', 'dark');
    });
    if (mobile) {
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', 'modern');
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', 'dark');
    }
    const row = await create(page, refs);
    const visibleRow = () => page.getByTestId(`${mobile ? 'card' : 'row'}-sales-target-${row.id}`);
    const actionId = (action) => `button-${action}-sales-target-${mobile ? 'mobile-' : ''}${row.id}`;
    await expect(visibleRow()).toContainText('Super Admin');
    const other = await context.newPage();
    await other.goto(`${base()}/admin/masters/sales-targets`);
    await expect(other.getByTestId(`row-sales-target-${row.id}`)).toContainText(refs.mr.name);
    await other.close();
    await page.reload();
    await expect(visibleRow()).toBeVisible();
    await page.getByTestId(actionId('edit')).click();
    await expect(page.getByTestId('button-save-sales-target')).toBeEnabled();
    await page.getByTestId('input-sales-target-q1').fill('10.25');
    await page.evaluate(async (record) => {
      const service = await import('/src/services/serverSalesTargets.js');
      const { mrId, startYear, endYear, q1, q2, q3, q4, status } = record;
      await service.editSalesTarget(record, { mrId, startYear, endYear, q1, q2, q3, q4: '1.01', status });
    }, row);
    await page.getByTestId('button-save-sales-target').click();
    await expect(page.getByTestId('status-sales-target-form-error')).toContainText('changed');
    await expect(page.getByTestId('input-sales-target-q1')).toHaveValue('10.25');
    await expect(page.getByTestId('button-save-sales-target')).toBeDisabled();
    await page.getByTestId('button-cancel-sales-target').click();
    await expect(visibleRow()).toBeVisible();
    await page.getByTestId(actionId('edit')).click();
    await page.getByTestId('input-sales-target-q1').fill('10.25');
    await page.getByTestId('button-save-sales-target').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId(actionId('toggle')).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`status-sales-target-${mobile ? 'mobile-' : ''}${row.id}`)).toHaveText('Inactive');
    await page.getByTestId('input-search-sales-targets').fill(refs.mr.name);
    await page.getByTestId('select-filter-sales-target-status').selectOption('inactive');
    await page.getByTestId('button-apply-sales-target-filters').click();
    await expect(page.getByTestId('text-sales-target-count')).toContainText('of 1');
    await page.getByTestId('select-filter-sales-target-status').selectOption('active');
    await page.getByTestId('button-apply-sales-target-filters').click();
    await expect(page.getByTestId('status-sales-target-empty')).toBeVisible();
    await expect(page.getByTestId('text-sales-target-total-total')).toHaveText('₹0');
    await page.getByTestId('button-sales-target-summary').click();
    await expect(page.getByTestId('text-summary-total')).toHaveText('₹0');
    await page.getByTestId('button-close-target-summary').click();
    await page.getByTestId('button-reset-sales-target-filters').click();
    await expect(visibleRow()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`sales-target-${mobile ? 'mobile-dark' : 'desktop-light'}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId(actionId('delete')).click();
    await page.getByTestId('button-cancel-confirmation').click();
    await expect(visibleRow()).toBeVisible();
    await page.getByTestId(actionId('delete')).click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(visibleRow()).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(legacy);
  });
}

test('sales target prepared CSV/XLSX imports, historical financial filters, all-match totals and authenticated exports', async ({ page }) => {
  test.setTimeout(180000);
  const refs = await open(page);
  await page.goto(`${base()}/admin/masters/import/sales-target`);
  await expect(page.getByRole('button', { name: 'Sales Target Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Back to Sales Target Master', exact: true }).click();
  await expect(page.getByTestId('text-sales-target-count')).toBeVisible();
  await page.getByTestId('button-import-sales-targets').click();
  await expect(page.getByRole('button', { name: 'Sales Target Master', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const [label, format] of [['CSV', 'csv'], ['Excel', 'xlsx']]) {
    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${label} sample`, exact: true }).click();
    const download = await wait;
    const bytes = await readFile(await download.path());
    expect(download.suggestedFilename()).toBe(`evexia-sales-target-template.${format}`);
    if (format === 'csv') expect(bytes.toString('utf8')).toContain(header);
    else expect(bytes.subarray(0, 2).toString()).toBe('PK');
  }
  const data = `${header}\n${refs.mr.employeeCode},1980,1981,1.25,2,3,4,active\n${refs.mr.employeeCode},1982,1983,1.25,2,3,4,inactive\n${refs.mr.employeeCode},1984,1985,1.25,2,3,4,inactive`;
  const picker = page.getByTestId('input-sales-target-import');
  await picker.setInputFiles({ name: 'targets.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('sales-target-excel-report')).toContainText('3 valid');
  await expect(page.getByTestId('sales-target-excel-report')).toContainText(refs.mr.employeeCode);
  await page.getByTestId('sales-target-excel-report').getByText(`Row 2 · ${refs.mr.employeeCode}`, { exact: false }).click();
  await expect(page.getByTestId('sales-target-excel-report').locator('dd').filter({ hasText: /^1980$/ })).toBeVisible();
  expect(await page.evaluate(async (mrId) => (await (await import('/src/services/serverSalesTargets.js')).listSalesTargets({ mrId })).filtered, refs.mr.id)).toBe(0);
  await page.getByTestId('button-confirm-sales-target-import').click();
  await expect(page.getByRole('status')).toContainText('3 targets imported');
  await page.getByRole('button', { name: 'Back to Sales Target Master' }).click();
  await expect(page.getByTestId('text-sales-target-count')).toBeVisible();
  await page.getByTestId('input-search-sales-targets').fill(refs.mr.name);
  await page.getByLabel('Rows per page', { exact: true }).selectOption('2');
  await expect(page.getByTestId('text-sales-target-count')).toContainText('of 3');
  await expect(page.getByTestId('text-sales-target-total-total')).toHaveText('₹30.75');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-sales-target-count')).toContainText('3–3');
  await page.getByTestId('button-sales-target-summary').click();
  await expect(page.getByTestId('text-summary-total')).toHaveText('₹30.75');
  await page.getByTestId('button-close-target-summary').click();
  await choose(page, 'filter-sales-target-start', '1980', '1980');
  await choose(page, 'filter-sales-target-end', '1981', '1981');
  await page.getByTestId('button-apply-sales-target-filters').click();
  await expect(page.getByTestId('text-sales-target-count')).toContainText('1–1 of 1');
  await choose(page, 'filter-sales-target-zone', refs.zone.name, refs.zone.name);
  await choose(page, 'filter-sales-target-mr', refs.mr.employeeCode, `${refs.mr.name} (${refs.mr.employeeCode})`);
  await choose(page, 'filter-sales-target-zone', refs.otherZone.name, refs.otherZone.name);
  await expect(page.getByTestId('select-filter-sales-target-mr')).toHaveValue('');
  await page.getByTestId('button-reset-sales-target-filters').click();
  await page.getByTestId('input-search-sales-targets').fill(refs.mr.name);
  await expect(page.getByTestId('text-sales-target-count')).toContainText('of 3');
  await page.getByTestId('button-export-sales-targets').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('button-export-sales-targets')).toBeFocused();
  const files = [];
  for (const [label, format] of [['CSV', 'csv'], ['Excel (.xlsx)', 'xlsx']]) {
    await page.getByTestId('button-export-sales-targets').click();
    const wait = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    const download = await wait;
    const buffer = await readFile(await download.path());
    files.push({ name: `export.${format}`, mimeType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    if (format === 'csv') {
      expect(buffer.toString('utf8').match(new RegExp(refs.mr.employeeCode, 'g'))).toHaveLength(3);
      expect(buffer.toString('utf8')).toContain('Status,Created By,Created At,Updated By,Updated At');
    } else expect(buffer.subarray(0, 2).toString()).toBe('PK');
  }
  await page.getByTestId('button-import-sales-targets').click();
  for (const file of files) {
    await picker.setInputFiles(file);
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await expect(page.getByTestId('sales-target-excel-report')).toContainText('3 invalid');
    await expect(page.getByTestId('button-confirm-sales-target-import')).toBeDisabled();
  }
  // Genuine XLSX creation with the exact server-produced workbook schema.
  const xlsx = await page.evaluate(async (employeeCode) => {
    const { sampleSalesTargets } = await import('/src/services/serverSalesTargets.js');
    const bytes = new Uint8Array(await (await sampleSalesTargets('xlsx')).arrayBuffer());
    return Array.from(bytes);
  }, refs.mr.employeeCode);
  // Prepare xlsx using the supported spreadsheet producer in the test process, not the app.
  const { execFileSync } = await import('node:child_process');
  const book = execFileSync('python3', ['-c', 'import io,sys,json; from openpyxl import Workbook; b=Workbook(); [b.active.append(r) for r in json.loads(sys.argv[1])]; o=io.BytesIO(); b.save(o); sys.stdout.buffer.write(o.getvalue())',
    JSON.stringify([header.split(','), [refs.mr.employeeCode, '1990', '1991', '1.25', '2', '3', '4', 'active']])]);
  expect(Buffer.from(xlsx).subarray(0, 2).toString()).toBe('PK');
  await picker.setInputFiles({ name: 'create.xlsx', mimeType: files[1].mimeType, buffer: book });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('sales-target-excel-report')).toContainText('1 valid');
  await page.getByTestId('button-confirm-sales-target-import').click();
  await expect(page.getByRole('status')).toContainText('1 targets imported');
  // Seven-column legacy backups explicitly default active.
  await picker.setInputFiles({ name: 'legacy.csv', mimeType: 'text/csv', buffer: Buffer.from(`${header.slice(0, -7)}\n${refs.mr.employeeCode},1992,1993,1,2,3,4`) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('sales-target-excel-report')).toContainText('1 valid');
  await page.getByTestId('button-confirm-sales-target-import').click();
  await expect(page.getByRole('status')).toContainText('1 targets imported');
  // Failed/conflicting confirmation consumes the review and never saves the other row.
  const conflict = `${header}\n${refs.mr.employeeCode},1994,1995,1,2,3,4,active\n${refs.mr.employeeCode},1996,1997,1,2,3,4,active`;
  await picker.setInputFiles({ name: 'conflict.csv', mimeType: 'text/csv', buffer: Buffer.from(conflict) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('sales-target-excel-report')).toContainText('2 valid');
  await page.evaluate(async (mrId) => {
    const service = await import('/src/services/serverSalesTargets.js');
    await service.createSalesTarget({ mrId, startYear: 1996, endYear: 1997, q1: '1', q2: '2', q3: '3', q4: '4', status: 'active' });
  }, refs.mr.id);
  await page.getByTestId('button-confirm-sales-target-import').click();
  await expect(page.getByRole('alert')).toContainText('Nothing was imported');
  await expect(page.getByTestId('sales-target-excel-report')).toHaveCount(0);
  expect(await page.evaluate(async (mrId) => (await (await import('/src/services/serverSalesTargets.js')).listSalesTargets({ mrId, startYear: 1994 })).filtered, refs.mr.id)).toBe(0);
  await page.screenshot({ path: test.info().outputPath('sales-target-import-report.png'), fullPage: true });
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(legacy);
});

test('sales target listing ignores a stale response after search changes', async ({ page }) => {
  test.setTimeout(150000);
  const refs = await open(page);
  const record = await page.evaluate(async ({ mrId }) => {
    const service = await import('/src/services/serverSalesTargets.js');
    await service.createSalesTarget({ mrId, startYear: 2001, endYear: 2002, q1: '12.34', q2: '0', q3: '0', q4: '0', status: 'active' });
    return (await service.listSalesTargets({ limit: 10 })).items[0];
  }, { mrId: refs.mr.id });
  await page.reload();
  await expect(page.getByTestId(`row-sales-target-${record.id}`)).toBeVisible();
  const stalePage = await page.evaluate(async () => {
    const service = await import('/src/services/serverSalesTargets.js');
    return service.listSalesTargets({ limit: 10 });
  });
  let release;
  let reached;
  const intercepted = new Promise((resolve) => { reached = resolve; });
  const lateResponse = new Promise((resolve) => { release = resolve; });
  let handled;
  const completed = new Promise((resolve) => { handled = resolve; });
  await page.route('**/api/v1/admin/sales-targets?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('query') !== 'stale-response-old') return route.continue();
    reached();
    await lateResponse;
    try { await route.fulfill({ json: stalePage }); } catch {}
    handled();
  });
  await page.getByTestId('input-search-sales-targets').fill('stale-response-old');
  await intercepted;
  await page.getByTestId('input-search-sales-targets').fill('stale-response-new');
  await expect(page.getByTestId('status-sales-target-empty')).toBeVisible();
  release();
  await completed;
  await expect(page.getByTestId(`row-sales-target-${record.id}`)).toHaveCount(0);
  await expect(page.getByTestId('status-sales-target-empty')).toBeVisible();
});

test('sales target mounted drafts, selected files and late responses retain correct ownership during renewal', async ({ page }) => {
  test.setTimeout(150000);
  const refs = await open(page);
  await page.getByTestId('button-add-sales-target').click();
  await page.getByTestId('input-sales-target-q1').fill('123.45');
  let count = 0;
  await page.route('**/api/v1/auth/me', (route) => ++count === 1
    ? route.fulfill({ status: 503, json: { error: { message: 'Synthetic outage' } } }) : route.continue());
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession());
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(page.getByTestId('input-sales-target-q1')).toHaveValue('123.45');
  await page.unroute('**/api/v1/auth/me');
  await page.getByTestId('button-cancel-sales-target').click();
  await page.getByTestId('button-import-sales-targets').click();
  const data = `${header}\n${refs.mr.employeeCode},1970,1971,1,2,3,4,active`;
  const picker = page.getByTestId('input-sales-target-import');
  await picker.setInputFiles({ name: 'draft.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByText('draft.csv', { exact: true })).toBeVisible();
  let release, reached, finished;
  const arrived = new Promise((resolve) => { reached = resolve; });
  const handled = new Promise((resolve) => { finished = resolve; });
  await page.route('**/api/v1/admin/sales-targets/import/review?*', async (route) => {
    reached();
    await new Promise((resolve) => { release = resolve; });
    try {
      await route.fulfill({ json: { valid: true, validCount: 1, invalidCount: 0, digest: 'a'.repeat(64),
        rows: [{ row: 2, values: { employeeCode: 'LATE OLD FILE' }, errors: [] }] } });
    } finally { finished(); }
  });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await arrived;
  await picker.setInputFiles({ name: 'replacement.csv', mimeType: 'text/csv', buffer: Buffer.from(data) });
  release();
  await handled;
  await expect(page.getByText('LATE OLD FILE')).toHaveCount(0);
  await page.unroute('**/api/v1/admin/sales-targets/import/review?*');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/v1/admin/sales-targets/sample?format=csv', (route) => route.fulfill({ contentType: 'text/csv', body: header }));
  await page.getByRole('button', { name: 'Download CSV sample', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('logging could not be confirmed');
  expect(downloads).toBe(0);
  await page.unroute('**/api/v1/admin/sales-targets/sample?format=csv');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await expect(picker).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(legacy);
});
