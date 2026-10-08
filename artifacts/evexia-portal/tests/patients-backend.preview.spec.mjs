import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/patients';

async function seed(page) {
  const tag = crypto.randomUUID().slice(0, 8);
  await page.goto(base() + '/admin/login');
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return page.evaluate(async (tag) => {
    const auth = await import('/src/auth/adminSession.js');
    const hq = await auth.headquarterRequest('', { body: { name: `Patient HQ ${tag}`, status: 'active' } });
    const zone = await auth.zoneRequest('', { body: { name: `Patient Zone ${tag}`, status: 'active' } });
    const mr = (await auth.mrRequest('', { body: {
      name: `Patient MR ${tag}`, userId: `patient.mr.${tag}`, employeeCode: `PAT-${tag}`, contactRequirement: 'optional',
      dateOfJoining: '2020-01-01', designation: 'Synthetic', phone: '', email: '', hq: hq.id, zoneId: zone.id,
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark', pincode: '110001', city: 'Delhi',
      state: 'Delhi', country: 'India', status: 'active', paymentLimit: '0.00', doctorDaysLimit: 0,
    } })).record;
    const doctor = await auth.doctorRequest('', { body: {
      name: `Patient Doctor ${tag}`, registrationNumber: `PATREG-${tag}`, qualification: 'MBBS', phone: '', alternatePhone: '',
      email: '', contactRequirement: 'optional', dialCountry: 'IN', dateOfJoining: null, clinicName: 'Synthetic clinic',
      mrId: mr.id, status: 'active', invoiceType: 'normal', gstNumber: '', drugLicenceNumber: '', orderDiscount: '0.00',
      daysLimit: 0, paymentLimit: '0.00', pincode: '110001', addressLine1: 'Synthetic street', addressLine2: '',
      landmark: 'Landmark', country: 'India', state: 'Delhi', city: 'Delhi',
    } });
    return { tag, mr, zone, doctor };
  }, tag);
}
function values(refs, name = `Patient ${refs.tag}`) {
  return { name, gender: 'prefer not to say', phone: '123456789', dialCountry: 'AE', email: 'synthetic@example.com',
    dateOfBirth: '2000-02-29', doctorId: refs.doctor.id, instructionsLanguage: 'Hindi', status: 'active',
    addressLine1: 'Synthetic street', addressLine2: 'Second line', landmark: 'Landmark',
    pincode: '110001', country: 'India', state: 'Delhi', city: 'Manual city' };
}
async function create(page, values) {
  return page.evaluate(async (values) => (await import('/src/services/serverPatients.js')).createPatient(values), values);
}
async function detail(page, id) {
  return page.evaluate(async (id) => (await import('/src/services/serverPatients.js')).getPatient(id), id);
}
async function list(page, query) {
  return page.evaluate(async (query) => (await import('/src/services/serverPatients.js')).listPatients({ query }), query);
}

for (const mobile of [false, true]) test(`Patient ${mobile ? 'modern dark mobile' : 'classic light desktop'} fields persist and dosage stays empty`, async ({ page }, info) => {
  test.setTimeout(90000);
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const refs = await seed(page), body = values(refs);
  const legacy = JSON.stringify([{ id: 'PAT-LOCAL-000001', name: 'Untouched local patient' }]);
  await page.evaluate(({ legacy, mobile }) => {
    localStorage.setItem('evexia.admin.patients.v1', legacy);
    localStorage.setItem('evexia.admin.theme', mobile ? 'modern' : 'classic');
    localStorage.setItem('evexia.admin.appearance', mobile ? 'dark' : 'light');
  }, { legacy, mobile });
  await page.goto(base() + path);
  await expect(page.getByText('Untouched local patient')).toHaveCount(0);
  await page.getByTestId('button-add-patient').click();
  for (const key of ['name', 'phone', 'email', 'dateOfBirth']) await page.getByTestId(`input-patient-${key}`).fill(body[key]);
  const country = page.getByTestId('select-patient-dialCountry');
  await country.selectOption('AE');
  await expect(page.getByTestId('input-patient-phone')).toHaveValue(body.phone);
  await page.getByTestId('select-patient-gender').selectOption(body.gender);
  await expect(page.getByTestId('input-patient-age')).not.toHaveValue('');
  await page.getByTestId('tab-patient-care').click();
  await page.getByTestId('select-patient-doctorId').selectOption(body.doctorId);
  await page.getByTestId('select-patient-instructionsLanguage').selectOption(body.instructionsLanguage);
  await page.getByTestId('tab-patient-address').click();
  await page.route('**/api/v1/admin/patients/postal/110001*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ choices: [{ city: 'PIN district', state: 'Delhi', country: 'India' }], message: '' }),
  }));
  await page.getByTestId('input-patient-pincode').fill(body.pincode);
  await expect(page.getByTestId('input-patient-city')).toHaveValue('PIN district');
  for (const key of ['addressLine1', 'addressLine2', 'landmark', 'city']) await page.getByTestId(`input-patient-${key}`).fill(body[key]);
  await page.screenshot({ path: info.outputPath('patient-form.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByTestId('button-save-patient').click();
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
  const saved = (await list(page, body.name)).items[0];
  for (const [key, value] of Object.entries(body)) expect(saved[key], key).toBe(value);
  expect(saved.mrName).toBe(refs.mr.name);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.patients.v1'))).toBe(legacy);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base() + path + '/' + saved.id);
  await expect(page.getByTestId('input-patient-name')).toHaveValue(body.name);
  await page.getByTestId('input-patient-name').fill(body.name + ' edited');
  await page.getByTestId('button-save-patient').click();
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
  expect((await detail(page, saved.id)).name).toBe(body.name + ' edited');
  await page.goto(base() + path + '/' + saved.id + '/dosage-history');
  await expect(page.getByText(/No dosage history recorded/i)).toBeVisible();
  await page.screenshot({ path: info.outputPath('patient-history.png'), fullPage: true });
});

test('Patient PIN late/manual guards, server exports and prepared atomic CSV import', async ({ page }, info) => {
  test.setTimeout(90000);
  const refs = await seed(page);
  const body = values(refs), saved = await create(page, body);
  await page.goto(base() + path + '/' + saved.id);
  await page.getByTestId('tab-patient-address').click();
  await expect(page.getByTestId('input-patient-city')).toHaveValue('Manual city');
  let entered, release;
  const arrived = new Promise(r => { entered = r; });
  const held = new Promise(r => { release = r; });
  await page.route('**/api/v1/admin/patients/postal/400001*', async route => {
    entered(); await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ city: 'Late city', state: 'Maharashtra', country: 'India' }], message: '' }) }).catch(() => {});
  });
  await page.getByTestId('input-patient-pincode').fill('400001');
  await arrived;
  await page.getByTestId('input-patient-city').fill('Manual correction');
  release();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('input-patient-city')).toHaveValue('Manual correction');
  await page.getByTestId('button-save-patient').click();
  await expect(page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
  await page.getByTestId('input-search-patients').fill(body.name);
  await expect(page.getByTestId('button-export-patients')).toBeEnabled();
  const trigger = page.getByTestId('button-export-patients');
  await expect(trigger).toBeVisible();
  await trigger.focus(); await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  for (const format of ['CSV', 'Excel (.xlsx)']) {
    await trigger.click();
    const event = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: format, exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toMatch(format === 'CSV' ? /\.csv$/ : /\.xlsx$/);
    expect((await readFile(await download.path())).length).toBeGreaterThan(200);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-busy', 'false');
  }
  await page.goto(base() + '/admin/masters/import/patient');
  await expect(page.getByRole('heading', { name: 'Import Patient data' })).toBeVisible();
  for (const format of ['csv', 'xlsx']) {
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('button-sample-patient-' + format).click();
    expect((await downloaded).suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  }
  const headers = ['Patient ID','Patient Name','Gender','Phone No.','Email ID','Date of Birth','Doctor ID','Doctor Registration Number','Instructions Language','Status','Address Line 1','Address Line 2','Landmark','Pincode','City','State','Country'];
  const row = ['', `Imported ${refs.tag}`, 'Female', '9000000000', '', '2001-01-01', 'DOC-LOCAL-001', refs.doctor.registrationNumber, 'Hindi', 'active', 'Street', '', 'Landmark', '110001', 'Delhi', 'Delhi', 'India'];
  await page.getByTestId('input-patient-import').setInputFiles({ name: 'patients.csv', mimeType: 'text/csv', buffer: Buffer.from(headers.join(',') + '\n' + row.join(',')) });
  await page.getByTestId('button-review-patient-import').click();
  await expect(page.getByTestId('button-confirm-patient-import')).toBeEnabled();
  expect((await list(page, row[1])).filtered).toBe(0);
  await page.getByTestId('button-confirm-patient-import').click();
  await expect(page.getByText(/1 patient.*imported/i)).toBeVisible();
  expect((await list(page, row[1])).items[0].dialCountry).toBe('IN');
  await page.screenshot({ path: info.outputPath('patient-import.png'), fullPage: true });
});
