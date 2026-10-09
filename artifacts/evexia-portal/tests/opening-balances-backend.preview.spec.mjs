import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/opening-balances';
const importPath = '/admin/masters/import/opening-balance';
const legacyKey = 'evexia.admin.doctor-opening-balances.v1';
const legacy = '[{"id":"legacy-balance","amount":-25.5}]';
const tag = () => crypto.randomUUID().slice(0, 8);

async function seed(page, mobile = false) {
  const label = tag();
  await page.goto(base() + '/admin/login');
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const doctor = await page.evaluate(async ({ label, legacyKey, legacy, mobile }) => {
    localStorage.setItem(legacyKey, legacy);
    const prefs = await import('/src/components/admin/adminPreferences.js');
    prefs.setAdminPreference('theme', mobile ? 'modern' : 'classic');
    prefs.setAdminPreference('appearance', mobile ? 'dark' : 'light');
    const session = await import('/src/auth/adminSession.js');
    const hq = await session.headquarterRequest('', { body: { name: `OB HQ ${label}`, status: 'active' } });
    const zone = await session.zoneRequest('', { body: { name: `OB Zone ${label}`, status: 'active' } });
    const mr = await session.mrRequest('', { body: {
      name: `OB MR ${label}`, userId: `balance.mr.${label}`, employeeCode: `OB-${label}`, contactRequirement: 'optional',
      dateOfJoining: '2020-01-01', designation_id: (await session.designationRequest('', { body: { name: `Balance MR designation ${label}`, shortName: 'MR', status: 'active' } })).id, phone: '', email: '', hq: hq.id, zoneId: zone.id,
      addressLine1: 'Address', landmark: 'Landmark', pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
      status: 'active', paymentLimit: '0.00', doctorDaysLimit: 0,
    } });
    return session.doctorRequest('', { body: {
      name: `OB Doctor ${label}`, registrationNumber: `OB-REG-${label}`, qualification: 'MBBS', phone: '',
      alternatePhone: '', email: '', contactRequirement: 'optional', dialCountry: 'IN', dateOfJoining: null,
      clinicName: 'Clinic', mrId: mr.record.id, status: 'active', invoiceType: 'normal', gstNumber: '',
      drugLicenceNumber: '', orderDiscount: '0.00', daysLimit: 0, paymentLimit: '0.00', pincode: '110001',
      addressLine1: 'Address', addressLine2: '', landmark: 'Landmark', country: 'India', state: 'Delhi', city: 'Delhi',
    } });
  }, { label, legacyKey, legacy, mobile });
  await page.goto(base() + path);
  await expect(page.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
  return doctor;
}

const body = (doctor, changes = {}) => ({ startYear: 1900, endYear: 1901, doctorId: doctor.id, amount: '-9999999999999.99', status: 'active', ...changes });
async function create(page, doctor, changes) {
  return page.evaluate(async (values) => (await import('/src/services/serverOpeningBalances.js')).createOpeningBalance(values), body(doctor, changes));
}
async function chooseYear(page, start, year) {
  const input = page.getByRole('combobox', { name: `Financial ${start ? 'start' : 'end'} year` });
  await input.fill(String(year));
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue(String(year));
}
async function filter(page, query) {
  await page.getByRole('textbox', { name: 'Search opening balances' }).fill(query);
  await expect(page.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeEnabled();
}

test('Opening Balance modal cancel, pending close, renewal, failure and uncertain outcome preserve listing and draft', async ({ page }) => {
  test.setTimeout(90000);
  const doctor = await seed(page);
  await filter(page, doctor.registrationNumber);
  const add = page.getByTestId('button-add-opening-balance');
  await add.click();
  const start = page.getByRole('combobox', { name: 'Financial start year' });
  await start.click(); await start.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(add).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Search opening balances' })).toHaveValue(doctor.registrationNumber);
  await add.click();
  const select = page.getByRole('combobox', { name: 'Doctor', exact: true });
  await select.fill(doctor.registrationNumber);
  await page.getByRole('option', { name: `${doctor.name} · ${doctor.registrationNumber}`, exact: true }).click();
  const amount = page.getByTestId('input-opening-balance-amount');
  await amount.fill('12.34');
  await page.evaluate(() => { window.__balanceDraftNode = document.getElementById('ob-amount'); });
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession());
  await expect(amount).toHaveValue('12.34');
  expect(await page.evaluate(() => window.__balanceDraftNode === document.getElementById('ob-amount'))).toBe(true);
  let release;
  let entered;
  const arrived = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  // The master transport can append an empty query string to POST URLs.
  const endpoint = /\/api\/v1\/admin\/opening-balances(?:\?.*)?$/;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    entered(); await gate;
    await route.fulfill({ status: 503, json: { error: { message: 'Synthetic retryable save failure', code: 'opening_balance_unavailable' } } });
  });
  await page.getByTestId('button-save-opening-balance').click();
  await arrived;
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.getByTestId('button-close-dialog').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('Synthetic retryable save failure');
  await expect(amount).toHaveValue('12.34');
  await expect(page.getByTestId('button-save-opening-balance')).toBeEnabled();
  await page.unroute(endpoint);
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch(); await route.abort();
  });
  await page.getByTestId('button-save-opening-balance').click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByTestId('button-save-opening-balance')).toBeDisabled();
  await expect(amount).toHaveValue('12.34');
  await page.unroute(endpoint);
  await page.getByRole('button', { name: 'Inspect shared records' }).click();
  await expect(add).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Search opening balances' })).toHaveValue(doctor.registrationNumber);
  await page.getByRole('button', { name: 'Refresh records', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: doctor.name })).toContainText('12.34');
  await page.goto(base() + path + '/new');
  await expect(page.getByTestId('input-opening-balance-amount')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`Opening Balance ${mobile ? 'Modern dark mobile' : 'Classic light desktop'} exact saved form, searchable years, reference and persistence`, async ({ page, context }, info) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const doctor = await seed(page, mobile);
    await page.getByRole('button', { name: 'Add opening balance', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add opening balance' })).toBeVisible();
    await expect(page).toHaveURL(base() + path);
    await expect(page.getByText(/Same-identity renewal|Saving does not post ledger|Signed plain decimal|Follows start year/)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Financial start year' })).toHaveValue(String(new Date().getFullYear()));
    await expect(page.getByRole('combobox', { name: 'Financial end year' })).toHaveValue(String(new Date().getFullYear() + 1));
    await chooseYear(page, true, 1900);
    await expect(page.getByRole('combobox', { name: 'Financial end year' })).toHaveValue('1901');
    await chooseYear(page, false, 1902);
    await page.getByTestId('button-save-opening-balance').click();
    await expect(page.getByText('End year must immediately follow the start year.')).toBeVisible();
    await chooseYear(page, false, 1901);
    const start = page.getByRole('combobox', { name: 'Financial start year' });
    await start.fill('no-such-year');
    await expect(page.getByText('No matches found', { exact: true })).toBeVisible();
    await start.press('Escape');
    await expect(start).toHaveValue('1900');
    await start.click();
    await page.getByRole('heading', { name: 'Add opening balance', exact: true }).click();
    await expect(start).toHaveAttribute('aria-expanded', 'false');
    const select = page.getByRole('combobox', { name: 'Doctor', exact: true });
    await select.fill(doctor.registrationNumber);
    await page.getByRole('option', { name: `${doctor.name} · ${doctor.registrationNumber}`, exact: true }).click();
    await page.getByTestId('input-opening-balance-amount').fill('-9999999999999.99');
    await page.screenshot({ path: info.outputPath('opening-balance-form.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByTestId('button-save-opening-balance').click();
    await expect(page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('button-add-opening-balance')).toBeFocused();
    await filter(page, doctor.registrationNumber);
    await expect(page.locator(mobile ? 'article[role=listitem]' : 'tbody tr').filter({ hasText: doctor.name })).toContainText('-99,99,99,99,99,999.99');
    const other = await context.newPage();
    await other.goto(base() + path);
    await expect(other.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
    await filter(other, doctor.registrationNumber);
    await expect(other.getByText(doctor.name, { exact: true }).first()).toBeVisible();
    await other.close();
    await page.reload();
    await expect(page.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), legacyKey)).toBe(legacy);
    const row = await page.evaluate(async (query) => (await import('/src/services/serverOpeningBalances.js')).listOpeningBalances({ query }), doctor.registrationNumber);
    await page.goto(base() + `${path}/${row.items[0].id}`);
    await expect(start).toHaveValue('1900');
    await expect(page.getByTestId('input-opening-balance-amount')).toHaveValue('-9999999999999.99');
  });
}

test('Opening Balance edit conflicts retain drafts, renewal retains mounted form, inactive reference is retained, stale delete is blocked', async ({ page }, info) => {
  test.setTimeout(90000);
  const doctor = await seed(page);
  const record = await create(page, doctor);
  await page.goto(base() + `${path}/${record.id}`);
  await expect(page.getByTestId('input-opening-balance-amount')).toHaveValue(record.amount);
  await page.getByTestId('input-opening-balance-amount').fill('-12.50');
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('input-opening-balance-amount')).toHaveValue('-12.50');
  await page.evaluate(async ({ record, doctor }) => {
    const service = await import('/src/services/serverOpeningBalances.js');
    await service.editOpeningBalance(record, { startYear: 1900, endYear: 1901, doctorId: doctor.id, amount: '5.00', status: 'active' });
  }, { record, doctor });
  await page.getByTestId('button-save-opening-balance').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Opening balance changed' })).toBeVisible();
  await expect(page.getByTestId('input-opening-balance-amount')).toHaveValue('-12.50');
  await expect(page.getByTestId('button-save-opening-balance')).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reload current details and discard draft' }).click();
  await expect(page.getByTestId('input-opening-balance-amount')).toHaveValue('5.00');
  await page.evaluate(async (doctor) => (await import('/src/services/serverDoctors.js')).statusDoctor(doctor, 'inactive'), doctor);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveValue(new RegExp('saved inactive'));
  await page.getByTestId('input-opening-balance-amount').fill('0.00');
  await page.getByTestId('button-save-opening-balance').click();
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
  await filter(page, doctor.registrationNumber);
  await page.getByRole('button', { name: `Delete balance for ${doctor.name}`, exact: true }).click();
  await page.evaluate(async (id) => {
    const service = await import('/src/services/serverOpeningBalances.js');
    const current = await service.getOpeningBalance(id);
    await service.statusOpeningBalance(current, 'inactive');
  }, record.id);
  await page.getByRole('button', { name: 'Delete balance', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Opening balance changed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete balance', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('opening-balance-conflict.png'), fullPage: true });
});

test('Opening Balance shared import CSV/XLSX review, errors, filtered downloads and deletion round trips', async ({ page }, info) => {
  test.setTimeout(120000);
  const doctor = await seed(page);
  const record = await create(page, doctor);
  await create(page, doctor, { startYear: 1901, endYear: 1902, amount: '12.25', status: 'inactive' });
  await page.goto(base() + path);
  await expect(page.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
  await filter(page, doctor.registrationNumber);
  await page.getByLabel('Status', { exact: true }).selectOption('active');
  await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeEnabled();
  const exports = [];
  for (const fmt of ['csv', 'xlsx']) {
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: fmt === 'csv' ? 'CSV' : 'Excel (.xlsx)', exact: true }).click();
    const saved = await download;
    const bytes = await readFile(await saved.path());
    exports.push({ fmt, bytes });
    if (fmt === 'csv') {
      expect(bytes.toString()).toContain("'-9999999999999.99");
      expect(bytes.toString()).not.toContain('12.25');
    } else {
      const rows = JSON.parse(execFileSync('python3', ['-c', 'import sys,io,json,openpyxl;print(json.dumps(list(openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read())).active.values)))'], { input: bytes, encoding: 'utf8' }));
      expect(rows).toHaveLength(2);
    }
    expect(bytes.toString()).not.toContain('Bearer');
  }
  await page.getByRole('button', { name: 'Import data', exact: true }).click();
  await expect(page).toHaveURL(base() + importPath);
  await expect(page.getByRole('button', { name: 'Opening Balance Master', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Doctor Master', exact: true })).toBeVisible();
  for (const name of ['Download CSV sample', 'Download Excel sample']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    expect((await readFile(await (await pending).path())).length).toBeGreaterThan(30);
  }
  const picker = page.getByTestId('input-opening-balance-import');
  await picker.setInputFiles({ name: 'missing.csv', mimeType: 'text/csv', buffer: Buffer.from('Financial Start Year,Financial End Year,Doctor Registration Number,Opening Balance,Status\n2026,2028,LOCAL-MISSING,1.234,active') });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await expect(page.getByTestId('opening-balance-excel-report')).toContainText('Registration must resolve');
  await expect(page.getByRole('button', { name: /Confirm import of/ })).toBeDisabled();
  for (const { fmt, bytes } of exports) {
    const live = await page.evaluate(async (id) => (await import('/src/services/serverOpeningBalances.js')).getOpeningBalance(id), fmt === 'csv' ? record.id : exports[0].newId);
    await page.evaluate(async (row) => (await import('/src/services/serverOpeningBalances.js')).deleteOpeningBalance(row), live);
    await picker.setInputFiles({ name: `backup.${fmt}`, mimeType: fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
    await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
    await expect(page.getByTestId('opening-balance-excel-report')).toContainText('All rows valid');
    await page.getByRole('button', { name: 'Confirm import of 1 opening balances', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 opening balances imported' })).toBeVisible();
    const row = await page.evaluate(async (registration) => (await import('/src/services/serverOpeningBalances.js')).listOpeningBalances({ query: registration, status: 'active' }), doctor.registrationNumber);
    expect(row.items[0].amount).toBe('-9999999999999.99');
    exports[0].newId = row.items[0].id;
  }
  await page.screenshot({ path: info.outputPath('opening-balance-import.png'), fullPage: true });
  expect(await page.evaluate((key) => localStorage.getItem(key), legacyKey)).toBe(legacy);
});

for (const mobile of [false, true]) {
  test(`Opening Balance cold-route selectors ${mobile ? 'dark mobile' : 'light desktop'} have styled bounded overlays`, async ({ page }, info) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const doctor = await seed(page, mobile);
    await page.getByRole('button', { name: 'Add opening balance', exact: true }).click();
    const start = page.getByRole('combobox', { name: 'Financial start year' });
    await start.click();
    const menu = page.getByRole('listbox', { name: 'Financial start year' });
    await expect(menu).toBeVisible();
    const geometry = await menu.evaluate((node) => {
      const style = getComputedStyle(node);
      const control = node.parentElement.querySelector('.searchable-select__control');
      return { position: style.position, overflow: style.overflowY, maxHeight: style.maxHeight,
        height: node.getBoundingClientRect().height, scrollHeight: node.scrollHeight,
        controlDisplay: getComputedStyle(control).display, controlHeight: control.getBoundingClientRect().height,
        containerKind: node.closest('.admin-dialog') ? 'dialog' : 'panel',
        panelOverflow: getComputedStyle(node.closest('.admin-dialog, .admin-panel')).overflowY };
    });
    expect(geometry.position).toBe('absolute');
    expect(geometry.overflow).toBe('auto');
    expect(geometry.maxHeight).toBe('260px');
    expect(geometry.height).toBeLessThanOrEqual(260);
    expect(geometry.scrollHeight).toBeGreaterThan(260);
    expect(geometry.controlDisplay).toBe('flex');
    expect(geometry.controlHeight).toBe(40);
    expect(geometry.panelOverflow).toBe(geometry.containerKind === 'dialog' ? 'auto' : 'visible');
    await page.screenshot({ path: info.outputPath('styled-year-overlay.png'), fullPage: true });
    await start.press('Escape');
    const select = page.getByRole('combobox', { name: 'Doctor', exact: true });
    const matchingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/opening-balances/references')
        && url.searchParams.get('query') === doctor.registrationNumber;
    });
    await select.fill(doctor.registrationNumber);
    expect((await matchingResponse).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: '1 choices in this section' })).toBeVisible();
    await expect(page.getByRole('option', { name: `${doctor.name} · ${doctor.registrationNumber}`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('styled-doctor-overlay.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}

test('Opening Balance Doctor picker searches beyond bounded results, retries errors, and discards late response on logout', async ({ page }) => {
  test.setTimeout(120000);
  const label = tag();
  await page.goto(base() + '/admin/login');
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const doctors = await page.evaluate(async (label) => {
    const s = await import('/src/auth/adminSession.js');
    const hq = await s.headquarterRequest('', { body: { name: `Extra HQ ${label}`, status: 'active' } });
    const zone = await s.zoneRequest('', { body: { name: `Extra Zone ${label}`, status: 'active' } });
    const mr = await s.mrRequest('', { body: {
      name: `Extra MR ${label}`, userId: `extra.mr.${label}`, employeeCode: `EXTRA-${label}`, contactRequirement: 'optional',
      dateOfJoining: '2020-01-01', designation_id: (await s.designationRequest('', { body: { name: `Extra MR designation ${label}`, shortName: 'MR', status: 'active' } })).id, phone: '', email: '', hq: hq.id, zoneId: zone.id,
      addressLine1: 'Address', landmark: 'Landmark', pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
      status: 'active', paymentLimit: '0.00', doctorDaysLimit: 0,
    } });
    const out = [];
    for (let i = 0; i < 51; i++) out.push(await s.doctorRequest('', { body: {
      name: `Paged ${label} ${String(i).padStart(2, '0')}`, registrationNumber: `PAGE-${label}-${String(i).padStart(2, '0')}`,
      qualification: 'MBBS', phone: '', alternatePhone: '', email: '', contactRequirement: 'optional', dialCountry: 'IN',
      dateOfJoining: null, clinicName: 'Clinic', mrId: mr.record.id, status: 'active', invoiceType: 'normal',
      gstNumber: '', drugLicenceNumber: '', orderDiscount: '0.00', daysLimit: 0, paymentLimit: '0.00',
      pincode: '110001', addressLine1: 'Address', addressLine2: '', landmark: 'Landmark', country: 'India', state: 'Delhi', city: 'Delhi',
    } }));
    return out.map((x) => x.record || x);
  }, label);
  let failFirst = true;
  await page.route('**/api/v1/admin/opening-balances/references**', async (route) => {
    if (failFirst) {
      failFirst = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic references unavailable' } }) });
    } else await route.continue();
  });
  await page.goto(base() + path);
  await expect(page.locator('[data-testid="text-opening-balance-count"], section[aria-label="Encrypted search section"]')).toBeVisible();
  await page.getByRole('button', { name: 'Add opening balance', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Retry Doctors', exact: true }).click();
  const doctorSelect = page.getByRole('combobox', { name: 'Doctor', exact: true });
  // Other release scenarios share this disposable catalogue. Filter to this
  // fixture before asserting counts rather than assuming an empty directory.
  await doctorSelect.fill(label);
  await expect(page.getByRole('status').filter({ hasText: '50 choices in this section' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue search', exact: true })).toBeEnabled();
  await doctorSelect.press('Escape');
  const secondPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/opening-balances/references')
      && url.searchParams.get('query') === label && Boolean(url.searchParams.get('cursor'));
  });
  await page.getByRole('button', { name: 'Continue search', exact: true }).click();
  expect((await secondPage).status()).toBe(200);
  const lastDoctor = [...doctors].sort((a, b) => a.id.localeCompare(b.id))[50];
  // Paging dismisses the overlay; reopening must retain its query and page,
  // not issue an unfiltered page-zero search.
  await doctorSelect.click();
  await page.getByRole('option', { name: `${lastDoctor.name} · ${lastDoctor.registrationNumber}`, exact: true }).click();
  await expect(doctorSelect).toHaveValue(new RegExp(lastDoctor.registrationNumber));
  await doctorSelect.fill(lastDoctor.registrationNumber);
  await expect(page.getByRole('option', { name: `${lastDoctor.name} · ${lastDoctor.registrationNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 choices in this section' })).toBeVisible();
  await doctorSelect.fill('no-matching-doctor-ever');
  await expect(page.getByRole('status').filter({ hasText: '0 choices in this section' })).toBeVisible();
  await doctorSelect.press('Escape');
  await expect(doctorSelect).toHaveValue(new RegExp(lastDoctor.registrationNumber));
  let release, arrivedResolve, handledResolve;
  const arrived = new Promise((resolve) => { arrivedResolve = resolve; });
  const handled = new Promise((resolve) => { handledResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/opening-balances/references**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('query') === 'late-response') {
      arrivedResolve();
      await gate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [doctors[50]], total: 1, limit: 50, offset: 0 }) }).catch(() => {});
      handledResolve();
    } else await route.continue();
  });
  await doctorSelect.fill('late-response');
  await arrived;
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  release();
  await handled;
  await expect(page.getByTestId('button-admin-profile')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveCount(0);
  await expect(page.getByText(doctors[50].name, { exact: true })).toHaveCount(0);
});

test('Opening Balance compact layout stays aligned and reachable in themes, short viewports and enlarged text', async ({ page }, info) => {
  test.setTimeout(120000);
  const doctor = await seed(page);
  for (const theme of ['classic', 'modern']) {
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(async ({ theme, appearance }) => {
        const prefs = await import('/src/components/admin/adminPreferences.js');
        prefs.setAdminPreference('theme', theme);
        prefs.setAdminPreference('appearance', appearance);
      }, { theme, appearance });
      for (const size of [{ width: 1280, height: 800 }, { width: 900, height: 360 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(size);
        await page.getByTestId('button-add-opening-balance').click();
        const dialog = page.getByRole('dialog', { name: 'Add opening balance' });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole('button', { name: /Previous Doctors|Next Doctors/ })).toHaveCount(0);
        await expect(dialog.locator('.admin-category-form__intro, .mr-form__body, .mr-form__footer')).toHaveCount(0);
        const layout = await dialog.evaluate((node) => {
          const rect = (selector) => {
            const box = node.querySelector(selector).getBoundingClientRect();
            return { x: box.x, y: box.y, height: box.height, width: box.width };
          };
          return { dialogWidth: node.getBoundingClientRect().width, padding: getComputedStyle(node).paddingLeft,
            bodyPadding: getComputedStyle(node.querySelector('.ob-form__body')).padding,
            gridGap: getComputedStyle(node.querySelector('.ob-form__grid')).gap,
            start: rect('.searchable-select:has(#opening-balance-start-year) .searchable-select__control'),
            end: rect('.searchable-select:has(#opening-balance-end-year) .searchable-select__control'),
            doctor: rect('.searchable-select:has(#opening-balance-doctor) .searchable-select__control'),
            amount: rect('#ob-amount'), status: rect('#ob-form-status'),
            footer: rect('.ob-form__footer') };
        });
        expect(layout.dialogWidth).toBeLessThanOrEqual(650);
        expect(layout.padding).toBe(size.width <= 600 ? '22px' : '27px');
        expect(layout.bodyPadding).toBe('0px');
        expect(layout.gridGap).toBe('16px');
        for (const field of ['start', 'end', 'doctor', 'amount', 'status']) expect(layout[field].height).toBe(40);
        expect(layout.start.x).toBeCloseTo(layout.doctor.x, 1);
        expect(layout.status.x).toBeCloseTo(layout.doctor.x, 1);
        if (size.width > 600) {
          expect(layout.start.y).toBeCloseTo(layout.end.y, 1);
          expect(layout.doctor.y).toBeCloseTo(layout.amount.y, 1);
          expect(layout.footer.y - (layout.status.y + layout.status.height)).toBeCloseTo(27, 1);
        } else {
          expect(layout.end.y).toBeGreaterThan(layout.start.y);
          expect(layout.amount.y).toBeGreaterThan(layout.doctor.y);
        }
        // Actual keyboard entry checks the dialog trap and styled focus, not just programmatic focus.
        await page.getByTestId('button-close-dialog').focus();
        await page.keyboard.press('Tab');
        const start = page.getByRole('combobox', { name: 'Financial start year' });
        await expect(start).toBeFocused();
        await expect(page.getByRole('listbox', { name: 'Financial start year' })).toBeVisible();
        await start.press('ArrowDown');
        await start.press('Enter');
        const select = page.getByRole('combobox', { name: 'Doctor', exact: true });
        await select.fill(doctor.registrationNumber);
        const option = page.getByRole('option', { name: `${doctor.name} · ${doctor.registrationNumber}`, exact: true });
        await expect(option).toBeVisible();
        await option.click();
        await page.getByTestId('input-opening-balance-amount').fill('1.234');
        await page.getByTestId('button-save-opening-balance').click();
        await expect(page.locator('#ob-amount-error')).toBeVisible();
        await expect(page.getByTestId('input-opening-balance-amount')).toHaveAttribute('aria-describedby', 'ob-amount-error');
        const doubled = await page.addStyleTag({ content: '.ob-add-dialog :is(label, input, select, button, p, .searchable-select__option, .mr-form__error) { font-size: 24px !important; } .ob-add-dialog h2 { font-size: 54px !important; }' });
        await select.fill(doctor.registrationNumber);
        await expect(option).toBeVisible();
        await option.click();
        await page.getByRole('button', { name: 'About Credit balances' }).click();
        await expect(page.getByText('Negative amounts indicate a credit balance. Zero is allowed.', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        if (theme === 'modern' && appearance === 'dark') await page.screenshot({ path: info.outputPath(`compact-${size.width}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await doubled.evaluate((node) => node.remove());
        await expect(page.getByTestId('button-add-opening-balance')).toBeFocused();
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base() + path + '/new');
  await expect(page.getByTestId('input-opening-balance-amount')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.ob-form-panel').evaluate((node) => getComputedStyle(node).overflowY)).toBe('visible');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('text-opening-balance-count')).toBeVisible();
});
