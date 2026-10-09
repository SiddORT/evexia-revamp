import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const listPath = '/admin/masters/doctors';
const legacyKey = 'evexia.admin.doctors.v1';
const tag = () => crypto.randomUUID().slice(0, 8);

async function seed(page, label) {
  await page.goto(base() + '/admin/login');
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return page.evaluate(async (label) => {
    const session = await import('/src/auth/adminSession.js');
    const hq = await session.headquarterRequest('', { body: { name: `Doctor HQ ${label}`, status: 'active' } });
    const zone = await session.zoneRequest('', { body: { name: `Doctor Zone ${label}`, status: 'active' } });
    const mr = await session.mrRequest('', { body: {
      name: `Doctor MR ${label}`, userId: `doctor.mr.${label}`, employeeCode: `DOCTOR-${label}`, contactRequirement: 'optional',
      dateOfJoining: '2020-01-01', designation_id: (await session.designationRequest('', { body: { name: `Doctor MR designation ${label}`, shortName: 'MR', status: 'active' } })).id,
      phone: '', email: '', hq: hq.id, zoneId: zone.id, addressLine1: 'Address', landmark: 'Landmark', pincode: '110001',
      city: 'Delhi', state: 'Delhi', country: 'India', status: 'active', paymentLimit: '0.00', doctorDaysLimit: 0,
    } });
    return { mr: mr.record, hq, zone };
  }, label);
}
function body(refs, label) {
  return { name: `Doctor ${label}`, registrationNumber: `REG-${label}`, qualification: 'MBBS', phone: '9000000001',
    alternatePhone: '9000000002', email: `${label}@example.com`, contactRequirement: 'required', dialCountry: 'IN',
    dateOfJoining: '2020-01-01', clinicName: `Clinic ${label}`, mrId: refs.mr.id, status: 'active',
    invoiceType: 'gst', gstNumber: '07ABCDE1234F1Z5', drugLicenceNumber: 'DL-0001',
    orderDiscount: '12.35', daysLimit: 45, paymentLimit: '1234567890123.45', pincode: '110001',
    addressLine1: 'Address line one', addressLine2: 'Address line two', landmark: 'Landmark',
    country: 'India', state: 'Delhi', city: 'Manual district' };
}
async function create(page, values) {
  return page.evaluate(async (values) => (await import('/src/services/serverDoctors.js')).createDoctor(values), values);
}
async function get(page, id) {
  return page.evaluate(async (id) => (await import('/src/services/serverDoctors.js')).getDoctor(id), id);
}
async function openList(page, query = '') {
  await page.goto(base() + listPath);
  await expect(page.getByTestId('input-search-doctors')).toBeVisible();
  if (query) {
    const response = page.waitForResponse((response) => response.url().includes('/api/v1/admin/doctors?') && response.url().includes(`query=${query}`));
    await page.getByTestId('input-search-doctors').fill(query);
    await response;
  }
  await expect(page.getByTestId('button-export-doctors')).toBeEnabled();
}

for (const mobile of [false, true]) {
  test(`Doctor ${mobile ? 'Modern dark mobile' : 'Classic light desktop'} all fields, automatic PIN and persisted edit`, async ({ page }, info) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const label = tag();
    const refs = await seed(page, label);
    const values = body(refs, label);
    const legacy = JSON.stringify([{ id: 'local-only', name: `Local Doctor ${label}` }]);
    await page.evaluate(({ key, legacy, mobile }) => {
      localStorage.setItem(key, legacy);
      localStorage.setItem('evexia.admin.theme', mobile ? 'modern' : 'classic');
      localStorage.setItem('evexia.admin.appearance', mobile ? 'dark' : 'light');
    }, { key: legacyKey, legacy, mobile });
    await openList(page);
    await expect(page.getByText(`Local Doctor ${label}`, { exact: true })).toHaveCount(0);
    await page.getByTestId('button-add-doctor').click();
    await expect(page.getByTestId('input-doctor-password')).toBeDisabled();
    await expect(page.getByTestId('button-generate-doctor-password')).toBeDisabled();
    await page.getByTestId('select-doctor-contactRequirement').selectOption('required');
    for (const key of ['name', 'phone', 'alternatePhone', 'email', 'dateOfJoining', 'registrationNumber', 'qualification']) {
      await page.getByTestId(`input-doctor-${key}`).fill(values[key]);
    }
    await page.getByTestId('select-doctor-dialCountry').selectOption('IN');
    await page.getByTestId('tab-doctor-clinic').click();
    await page.getByTestId('input-doctor-clinicName').fill(values.clinicName);
    await page.getByTestId('select-doctor-mrId').fill(refs.mr.name);
    await page.getByRole('option', { name: refs.mr.name, exact: true }).click();
    await expect(page.getByText(`Derived Zone: ${refs.zone.name}. Zone is controlled by MR Master.`)).toBeVisible();
    await page.getByTestId('tab-doctor-commercial').click();
    await page.getByTestId('select-doctor-invoiceType').selectOption('gst');
    for (const key of ['gstNumber', 'drugLicenceNumber', 'orderDiscount', 'daysLimit', 'paymentLimit']) {
      await page.getByTestId(`input-doctor-${key}`).fill(String(values[key]));
    }
    await page.getByTestId('tab-doctor-address').click();
    await page.route('**/api/v1/admin/doctors/postal/110001*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ pincode: '110001', choices: [
        { city: 'District A', state: 'Delhi', country: 'India' }, { city: 'District B', state: 'Delhi', country: 'India' },
      ], message: '' }),
    }));
    await page.getByTestId('input-doctor-pincode').fill('110001');
    await expect(page.getByTestId('input-doctor-city')).toHaveValue('District A');
    await expect(page.getByTestId('input-doctor-country')).toHaveValue('India');
    await expect(page.getByTestId('input-doctor-state')).toHaveValue('Delhi');
    await page.getByTestId('select-doctor-locality').selectOption('1');
    await expect(page.getByTestId('input-doctor-city')).toHaveValue('District B');
    await page.getByTestId('input-doctor-city').fill(values.city);
    for (const key of ['addressLine1', 'addressLine2', 'landmark']) await page.getByTestId(`input-doctor-${key}`).fill(values[key]);
    await page.screenshot({ path: info.outputPath('doctor-full-form.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByTestId('button-save-doctor').click();
    await expect(page).toHaveURL(new RegExp(`${listPath}(?:\\?.*)?$`));
    const saved = await page.evaluate(async (query) => (await import('/src/services/serverDoctors.js')).listDoctors({ query }), values.registrationNumber);
    expect(saved.filtered).toBeNull();
    expect(saved.partial).toBe(true);
    expect(saved.items).toHaveLength(1);
    const doctor = saved.items[0];
    for (const [key, value] of Object.entries(values)) expect(doctor[key], key).toBe(value);
    expect(doctor.zoneName).toBe(refs.zone.name);
    await page.goto(base() + `${listPath}/${doctor.id}`);
    await expect(page.getByTestId('input-doctor-name')).toHaveValue(values.name);
    await page.getByTestId('tab-doctor-address').click();
    await expect(page.getByTestId('input-doctor-city')).toHaveValue(values.city);
    await page.getByTestId('tab-doctor-identity').click();
    await page.getByTestId('input-doctor-name').fill(`${values.name} Edited`);
    await page.getByTestId('button-save-doctor').click();
    await expect(page).toHaveURL(new RegExp(`${listPath}(?:\\?.*)?$`));
    expect((await get(page, doctor.id)).name).toBe(`${values.name} Edited`);
    expect(await page.evaluate((key) => localStorage.getItem(key), legacyKey)).toBe(legacy);
  });
}

test('Doctor late PIN requests, manual address protection, non-Indian entries and same-identity renewal', async ({ page }) => {
  test.setTimeout(90000);
  const label = tag();
  const refs = await seed(page, label);
  const doctor = await create(page, body(refs, label));
  await page.goto(base() + `${listPath}/${doctor.id}`);
  await page.getByTestId('tab-doctor-address').click();
  await expect(page.getByTestId('input-doctor-city')).toHaveValue('Manual district');
  let release, arrived, drained;
  const seen = new Promise((r) => { arrived = r; });
  const gate = new Promise((r) => { release = r; });
  const done = new Promise((r) => { drained = r; });
  await page.route('**/api/v1/admin/doctors/postal/110002*', async (route) => {
    arrived(); await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pincode: '110002', choices: [{ city: 'Late old city', state: 'Old state', country: 'India' }], message: '' }) }).catch(() => {});
    drained();
  });
  await page.getByTestId('input-doctor-pincode').fill('110002');
  await seen;
  await page.getByTestId('input-doctor-city').fill('Manually protected');
  release(); await done;
  await expect(page.getByTestId('select-doctor-locality')).toBeVisible();
  await expect(page.getByTestId('input-doctor-city')).toHaveValue('Manually protected');
  await page.unroute('**/api/v1/admin/doctors/postal/110002*');
  await page.route('**/api/v1/admin/doctors/postal/110003*', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic postal service unavailable', code: 'mr_postal_unavailable' } }),
  }));
  await page.getByTestId('input-doctor-pincode').fill('110003');
  await expect(page.getByText('Pincode lookup is offline or unavailable. You can enter the address manually.', { exact: true })).toBeVisible();
  await page.getByTestId('input-doctor-country').fill('United Kingdom');
  await page.getByTestId('input-doctor-state').fill('England');
  await page.getByTestId('input-doctor-pincode').fill('SW1A 1AA');
  await page.getByTestId('input-doctor-city').fill('London');
  await page.getByTestId('tab-doctor-identity').click();
  await page.getByTestId('input-doctor-name').fill('Draft preserved after renewal');
  await page.route('**/api/v1/auth/refresh', (route) => route.abort('failed'));
  await page.evaluate(async () => { try { await (await import('/src/auth/adminSession.js')).verifySession(true); } catch {} });
  await expect(page.getByTestId('input-doctor-name')).toHaveValue('Draft preserved after renewal');
  await page.unroute('**/api/v1/auth/refresh');
  await page.evaluate(async () => { await (await import('/src/auth/adminSession.js')).verifySession(true); });
  await expect(page.getByTestId('input-doctor-name')).toHaveValue('Draft preserved after renewal');
  await page.getByTestId('button-save-doctor').click();
  await expect(page).toHaveURL(new RegExp(`${listPath}(?:\\?.*)?$`));
  expect((await get(page, doctor.id)).pincode).toBe('SW1A 1AA');
  // Definitive logout destroys protected drafts and cannot expose them to another identity.
  await page.goto(base() + `${listPath}/${doctor.id}`);
  await page.getByTestId('input-doctor-name').fill('Protected never persist');
  await page.evaluate(async () => { await (await import('/src/auth/adminSession.js')).logoutAdmin(); });
  await expect(page.getByTestId('form-doctor')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('Protected never persist');
});

test('Doctor server pagination/filter parity, atomic bulk actions, menus, live MR viewer and safe payments', async ({ page }, info) => {
  test.setTimeout(120000);
  const label = tag();
  const refs = await seed(page, label);
  const values = body(refs, label);
  const doctors = [];
  for (let index = 0; index < 13; index++) doctors.push(await create(page, { ...values, name: `Doctor ${label} ${index}`, registrationNumber: `REG-${label}-${index}` }));
  await openList(page, label);
  await expect(page.getByRole('button', { name: 'Continue search', exact: true })).toBeEnabled();
  await page.getByTestId('checkbox-select-all-doctors').check();
  await expect(page.getByTestId('text-selected-doctors')).toContainText('10');
  await page.getByRole('button', { name: 'Continue search', exact: true }).click();
  await expect(page.getByTestId('text-selected-doctors')).toHaveCount(0);
  await page.getByTestId('checkbox-select-all-doctors').check();
  await expect(page.getByTestId('text-selected-doctors')).toContainText('3');
  await page.getByTestId('button-verify-doctors').click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId('status-doctor-feedback')).toContainText('Verification updated');
  await expect(page.getByTestId('text-selected-doctors')).toHaveCount(0);
  const onPage = page.locator('[data-testid^="status-doctor-verification-"]');
  await expect(onPage.first()).toHaveText('Verified');
  await page.getByTestId('checkbox-select-all-doctors').check();
  await page.getByTestId('button-unverify-doctors').click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId('status-doctor-feedback')).toContainText('Verification updated');
  await expect(onPage.first()).toHaveText('Unverified');
  await page.getByTestId('checkbox-select-all-doctors').check();
  await page.getByTestId('button-shift-doctors').click();
  await page.getByTestId('select-shift-doctor-mr').fill(refs.mr.name);
  await page.getByRole('option', { name: refs.mr.name, exact: true }).click();
  await page.getByTestId('button-confirm-shift-doctors').click();
  await expect(page.getByTestId('status-doctor-feedback')).toContainText('MR assignment updated');
  // Ciphertext cannot supply a plaintext sort key; use the stable UUID section.
  const visibleId = (await page.locator('[data-testid^="row-doctor-"]').first().getAttribute('data-testid')).slice('row-doctor-'.length);
  const first = doctors.find((record) => record.id === visibleId);
  await page.getByTestId(`button-toggle-doctor-${first.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId('status-doctor-feedback')).toContainText('Doctor status updated');
  expect((await get(page, first.id)).status).toBe('inactive');
  await page.getByTestId(`button-contact-doctor-${first.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId('status-doctor-feedback')).toContainText('Contact rule updated');
  expect((await get(page, first.id)).contactRequirement).toBe('optional');
  await page.getByTestId('button-toggle-doctor-filters').click();
  await page.getByTestId('select-filter-doctor-status').selectOption('active');
  await expect(page.getByRole('button', { name: 'Continue search', exact: true })).toBeEnabled();
  const trigger = page.getByTestId('button-export-doctors');
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await page.mouse.click(10, 10);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  const csv = await csvDownload;
  const text = await readFile(await csv.path(), 'utf8');
  expect(text.split('\n').filter((line) => line.trim()).length).toBe(13); // header + 12 current matches, not current page only.
  await expect(trigger).toBeFocused();
  await trigger.click();
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  const excel = await xlsxDownload;
  expect((await readFile(await excel.path())).subarray(0, 2).toString()).toBe('PK');
  await page.getByTestId('button-reset-doctor-filters').click();
  await page.goto(base() + '/admin/masters/mrs');
  await page.getByTestId('input-search-mrs').fill(refs.mr.userId);
  await page.getByTestId(`row-mr-${refs.mr.id}`).getByTestId(`button-doctors-mr-${refs.mr.id}`).click();
  await expect(page.getByTestId('text-mr-doctor-count')).toContainText('13 live assigned doctors');
  await page.screenshot({ path: info.outputPath('doctor-mr-viewer.png'), fullPage: true });
  await page.goto(base() + `${listPath}/${first.id}/payments`);
  await expect(page.getByTestId('text-payment-doctor-name')).toHaveText(first.name);
  await expect(page.getByTestId('text-payments-demo-notice')).toContainText('never matched');
  await expect(page.getByTestId('status-doctor-payments-empty')).toContainText('No live payment history');
});

test('Doctor stale edit preserves draft and prevents blind replay', async ({ page }) => {
  const label = tag();
  const refs = await seed(page, label);
  const values = body(refs, label);
  const saved = await create(page, values);
  await page.goto(base() + `${listPath}/${saved.id}`);
  await page.getByTestId('input-doctor-name').fill('Unsaved conflict draft');
  await page.evaluate(async ({ saved, values }) => (await import('/src/services/serverDoctors.js')).editDoctor(saved, { ...values, name: 'Changed in other tab' }), { saved, values });
  await page.getByTestId('button-save-doctor').click();
  await expect(page.getByTestId('error-doctor-save')).toContainText('changed');
  await expect(page.getByTestId('input-doctor-name')).toHaveValue('Unsaved conflict draft');
  await expect(page.getByTestId('button-save-doctor')).toBeDisabled();
  expect((await get(page, saved.id)).name).toBe('Changed in other tab');
});

test('Doctor prepared CSV/XLSX samples, review-only, file replacement and atomic confirm', async ({ page }, info) => {
  test.setTimeout(90000);
  const label = tag();
  const refs = await seed(page, label);
  await page.goto(base() + '/admin/masters/import/doctor');
  await expect(page.getByRole('button', { name: 'Doctor Master', exact: true })).toHaveAttribute('aria-current', 'page');
  const csvPromise = page.waitForEvent('download');
  await page.getByTestId('button-sample-doctor-csv').click();
  expect((await csvPromise).suggestedFilename()).toMatch(/\.csv$/);
  const xlsxPromise = page.waitForEvent('download');
  await page.getByTestId('button-sample-doctor-xlsx').click();
  const xlsx = await xlsxPromise;
  const data = execFileSync('python3', ['-c', [
    'import sys,io,base64',
    'from openpyxl import load_workbook',
    'w=load_workbook(io.BytesIO(open(sys.argv[1],"rb").read()));s=w.active',
    's["A2"]="Imported "+sys.argv[3];s["I2"]="IMPORT-"+sys.argv[3];s["L2"]="user:"+sys.argv[2];s["M2"]=""',
    'b=io.BytesIO();w.save(b);print(base64.b64encode(b.getvalue()).decode())',
  ].join(';'), await xlsx.path(), refs.mr.userId, label], { encoding: 'utf8' });
  const file = { name: `doctor-${label}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(data.trim(), 'base64') };
  await page.getByTestId('input-doctor-import').setInputFiles(file);
  await page.getByTestId('button-review-doctor-import').click();
  await expect(page.getByTestId('doctor-excel-report')).toContainText('valid');
  await expect(page.getByTestId('button-confirm-doctor-import')).toBeEnabled();
  const beforeCommit = await page.evaluate(async (query) => (await import('/src/services/serverDoctors.js')).listDoctors({ query }), `IMPORT-${label}`);
  expect(beforeCommit.filtered).toBeNull();
  expect(beforeCommit.items).toHaveLength(0);
  await page.getByTestId('input-doctor-import').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,MR\nIncomplete,local-only') });
  await expect(page.getByTestId('doctor-excel-report')).toHaveCount(0);
  await page.getByTestId('button-review-doctor-import').click();
  await expect(page.getByRole('alert')).toContainText('template');
  await page.getByTestId('input-doctor-import').setInputFiles(file);
  await page.getByTestId('button-review-doctor-import').click();
  await expect(page.getByTestId('button-confirm-doctor-import')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('doctor-import-review.png'), fullPage: true });
  await page.getByTestId('button-confirm-doctor-import').click();
  await expect(page.getByRole('status').filter({ hasText: '1 doctors imported' })).toBeVisible();
  await expect(page.getByTestId('doctor-excel-report')).toHaveCount(0);
  const saved = await page.evaluate(async (query) => (await import('/src/services/serverDoctors.js')).listDoctors({ query }), `IMPORT-${label}`);
  expect(saved.filtered).toBeNull();
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0].mrId).toBe(refs.mr.id);
  expect(saved.items[0].zoneName).toBe(refs.zone.name);
});
