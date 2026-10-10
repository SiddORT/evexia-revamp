import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const tag = () => crypto.randomUUID().replaceAll('-', '').slice(0, 8);

async function signIn(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}

async function seedReferences(page, id) {
  return page.evaluate(async (id) => {
    const api = await import('/src/auth/adminSession.js');
    const hq = await api.headquarterRequest('', { body: { name: `Phone ${id} HQ`, status: 'active' } });
    const zone = await api.zoneRequest('', { body: { name: `Phone ${id} Zone`, status: 'active' } });
    const designation = await api.designationRequest('', { body: { name: `Phone ${id} Designation`, shortName: 'MR', status: 'active' } });
    const mr = (await api.mrRequest('', { body: {
      name: `Phone ${id} Prerequisite MR`, userId: `phone.mr.${id}`, employeeCode: `PMR-${id}`,
      contactRequirement: 'optional', phone: '', email: '', hq: hq.id, zoneId: zone.id,
      dateOfJoining: '2020-01-01', designation_id: designation.id, status: 'active', paymentLimit: '0.00',
      doctorDaysLimit: 0, pincode: '110001', addressLine1: 'Synthetic street', addressLine2: '',
      landmark: 'Landmark', city: 'Delhi', state: 'Delhi', country: 'India',
    } })).record;
    const doctor = await api.doctorRequest('', { body: {
      name: `Phone ${id} Prerequisite Doctor`, registrationNumber: `PHONE-${id}`, qualification: 'MBBS',
      phone: '', alternatePhone: '', email: '', contactRequirement: 'optional', dialCountry: 'IN',
      dateOfJoining: null, clinicName: 'Synthetic clinic', mrId: mr.id, status: 'active',
      invoiceType: 'normal', gstNumber: '', drugLicenceNumber: '', orderDiscount: '0.00',
      daysLimit: 0, paymentLimit: '0.00', pincode: '110001', addressLine1: 'Synthetic street',
      addressLine2: '', landmark: 'Landmark', country: 'India', state: 'Delhi', city: 'Delhi',
    } });
    return { hq, zone, designation, mr, doctor };
  }, id);
}

async function setAppearance(page, appearance) {
  await page.evaluate(async (appearance) => {
    const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
    setAdminPreference('appearance', appearance);
  }, appearance);
}

async function fillMRRequired(page, refs, id) {
  await page.getByTestId('select-mr-contactRequirement').selectOption('optional');
  await page.getByTestId('input-mr-name').fill(`Phone test MR ${id}`);
  await page.getByTestId('button-generate-mr-user-id').click();
  await expect(page.getByTestId('input-mr-userId')).toHaveValue(/^mr\.[a-f0-9]+$/);
  await page.getByTestId('tab-mr-assignment').click();
  for (const [control, option] of [
    ['select-mr-headquarters', `Phone ${id} HQ`],
    ['select-mr-zones', `Phone ${id} Zone`],
  ]) {
    const field = page.getByTestId(control);
    await field.click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await page.getByTestId('input-mr-employeeCode').fill(`MR-${id}`);
  await page.getByTestId('input-mr-dateOfJoining').fill('2020-01-01');
  const designation = page.getByTestId('select-mr-designations');
  await designation.fill(`Phone ${id} Designation`);
  await page.getByRole('option', { name: `Phone ${id} Designation`, exact: true }).click();
  await page.getByTestId('tab-mr-address').click();
  await page.getByTestId('input-mr-pincode').fill('110001');
  await page.getByTestId('input-mr-addressLine1').fill('Synthetic street');
  await page.getByTestId('input-mr-landmark').fill('Landmark');
  await page.getByTestId('input-mr-city').fill('Delhi');
  await page.getByTestId('input-mr-state').fill('Delhi');
  await page.getByTestId('input-mr-country').fill('India');
}

async function fillPatientRequired(page, refs, id) {
  await page.getByTestId('input-patient-name').fill(`Phone test Patient ${id}`);
  await page.getByTestId('input-patient-email').fill(`phone-${id}@example.test`);
  await page.getByTestId('input-patient-dateOfBirth').fill('2000-01-01');
  await page.getByTestId('select-patient-gender').selectOption('prefer not to say');
  await page.getByTestId('tab-patient-care').click();
  const doctor = page.getByTestId('select-patient-doctorId');
  await doctor.fill(refs.doctor.name);
  await page.getByRole('option', { name: refs.doctor.name, exact: false }).click();
  await page.getByTestId('select-patient-instructionsLanguage').selectOption('Hindi');
  await page.getByTestId('tab-patient-address').click();
  await page.getByTestId('input-patient-addressLine1').fill('Synthetic street');
  await page.getByTestId('input-patient-landmark').fill('Landmark');
  await page.getByTestId('input-patient-pincode').fill('110001');
  await page.getByTestId('input-patient-country').fill('India');
  await page.getByTestId('input-patient-state').fill('Delhi');
  await page.getByTestId('input-patient-city').fill('Delhi');
}

async function holdNextSave(page, urlPart, button, selector) {
  let release;
  let arrived = false;
  const held = new Promise((resolve) => { release = resolve; });
  // Master requests include a query delimiter even with no parameters. Match
  // the pathname rather than a glob that silently misses the trailing '?'.
  const matches = (url) => url.pathname === urlPart;
  const handler = async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    arrived = true;
    await held;
    await route.continue();
  };
  await page.route(matches, handler);
  const response = page.waitForResponse((r) => r.url().includes(urlPart) && r.request().method() === 'POST');
  await page.getByTestId(button).click();
  try {
    await expect.poll(() => arrived).toBe(true);
    await expect(page.getByTestId(selector)).toBeDisabled();
  } finally {
    release();
  }
  const completed = await response;
  await page.unroute(matches, handler);
  expect(completed.ok()).toBeTruthy();
  return completed.json();
}

test('MR and Patient shared country controls save and reload SG/EH/MF through Add/Edit forms', async ({ page }, info) => {
  test.setTimeout(120000);
  const id = tag();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const refs = await seedReferences(page, id);

  // Direct cold form visit, narrow viewport, both appearance modes.
  await setAppearance(page, 'light');
  await page.goto(`${base()}/admin/masters/mrs/new`);
  await expect(page.getByTestId('form-mr')).toBeVisible();
  const mrSelect = page.getByTestId('select-mr-dialCountry');
  await expect(mrSelect).toHaveValue('IN');
  for (const appearance of ['light', 'dark']) {
    await setAppearance(page, appearance);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const bounds = await mrSelect.evaluate((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width, scrollWidth: document.documentElement.scrollWidth, innerWidth };
    });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.innerWidth);
    await page.screenshot({ path: info.outputPath(`mr-cold-${appearance}-390.png`), fullPage: true });
  }
  await fillMRRequired(page, refs, id);
  const mrUsername = await page.getByTestId('input-mr-userId').inputValue();
  await expect(mrSelect.locator('option[value="EH"]')).toHaveCount(1);
  await expect(mrSelect.locator('option[value="MF"]')).toHaveCount(1);
  await page.getByTestId('tab-mr-identity').click();
  const mrCreateResponse = page.waitForResponse((r) =>
    new URL(r.url()).pathname === '/api/v1/admin/mrs' && r.request().method() === 'POST');
  await page.getByTestId('button-save-mr').click();
  const mrCreated = (await mrCreateResponse).json();
  const createdMR = (await mrCreated).record;
  await expect(page.getByRole('dialog')).toContainText(/credentials/i);
  expect(createdMR.userId).toBe(mrUsername);
  expect(createdMR.phone).toBe('');
  expect(createdMR.dialCountry).toBe('IN');
  await page.getByTestId('checkbox-credentials-saved').check();
  await page.getByTestId('button-close-credentials').click();

  // Edit: short input must focus phone; then hold a save to check the selector lock.
  await page.goto(`${base()}/admin/masters/mrs/${createdMR.id}`);
  await expect(page.getByTestId('form-mr')).toBeVisible();
  await page.getByTestId('input-mr-phone').fill('123');
  await page.getByTestId('select-mr-dialCountry').selectOption('SG');
  await page.getByTestId('tab-mr-identity').click();
  await page.getByTestId('button-save-mr').click();
  await expect(page.getByTestId('error-mr-phone')).toContainText(/valid phone number/i);
  await expect(page.getByTestId('input-mr-phone')).toBeFocused();
  await page.getByTestId('input-mr-phone').fill('81234567');
  await holdNextSave(page, `/api/v1/admin/mrs/${createdMR.id}/edit`, 'button-save-mr', 'select-mr-dialCountry');
  await expect(page).toHaveURL(/\/admin\/masters\/mrs(?:\?.*)?$/);
  await page.goto(`${base()}/admin/masters/mrs/${createdMR.id}`);
  await expect(page.getByTestId('select-mr-dialCountry')).toHaveValue('SG');
  await expect(page.getByTestId('input-mr-phone')).toHaveValue('81234567');
  for (const [country, phone] of [['EH', '528812345'], ['MF', '590271234']]) {
    await page.getByTestId('select-mr-dialCountry').selectOption(country);
    await page.getByTestId('input-mr-phone').fill(phone);
    await page.getByTestId('button-save-mr').click();
    await expect(page).toHaveURL(/\/admin\/masters\/mrs(?:\?.*)?$/);
    await page.goto(`${base()}/admin/masters/mrs/${createdMR.id}`);
    await expect(page.getByTestId('select-mr-dialCountry')).toHaveValue(country);
    await expect(page.getByTestId('input-mr-phone')).toHaveValue(phone);
    await page.screenshot({ path: info.outputPath(`mr-${country.toLowerCase()}-edit-form.png`), fullPage: true });
  }

  // A second direct cold form visit covers the patient control with the API-seeded Doctor.
  await setAppearance(page, 'light');
  await page.goto(`${base()}/admin/masters/patients/new`);
  await expect(page.getByTestId('form-patient')).toBeVisible();
  const patientSelect = page.getByTestId('select-patient-dialCountry');
  await expect(patientSelect).toHaveValue('IN');
  for (const appearance of ['light', 'dark']) {
    await setAppearance(page, appearance);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const bounds = await patientSelect.evaluate((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width, scrollWidth: document.documentElement.scrollWidth, innerWidth };
    });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.innerWidth);
    await page.screenshot({ path: info.outputPath(`patient-cold-${appearance}-390.png`), fullPage: true });
  }
  await fillPatientRequired(page, refs, id);
  await expect(patientSelect.locator('option[value="EH"]')).toHaveCount(1);
  await expect(patientSelect.locator('option[value="MF"]')).toHaveCount(1);
  await page.getByTestId('tab-patient-identity').click();
  await page.getByTestId('input-patient-phone').fill('123');
  await patientSelect.selectOption('SG');
  await page.getByTestId('button-save-patient').click();
  await expect(page.getByTestId('error-patient-phone')).toContainText('Enter a valid national phone number for Singapore.');
  await expect(page.getByTestId('input-patient-phone')).toBeFocused();
  await page.getByTestId('input-patient-phone').fill('81234567');
  const patient = await holdNextSave(page, '/api/v1/admin/patients', 'button-save-patient', 'select-patient-dialCountry');
  expect(patient.dialCountry).toBe('SG');
  expect(patient.phone).toBe('81234567');
  await expect(page).toHaveURL(/\/admin\/masters\/patients(?:\?.*)?$/);
  await page.goto(`${base()}/admin/masters/patients/${patient.id}`);
  await expect(patientSelect).toHaveValue('SG');
  await expect(page.getByTestId('input-patient-phone')).toHaveValue('81234567');
  await page.screenshot({ path: info.outputPath('patient-sg-edit-form.png'), fullPage: true });
  for (const [country, phone] of [['EH', '528812345'], ['MF', '590271234']]) {
    await patientSelect.selectOption(country);
    await page.getByTestId('input-patient-phone').fill(phone);
    await page.getByTestId('button-save-patient').click();
    await expect(page).toHaveURL(/\/admin\/masters\/patients(?:\?.*)?$/);
    await page.goto(`${base()}/admin/masters/patients/${patient.id}`);
    await expect(patientSelect).toHaveValue(country);
    await expect(page.getByTestId('input-patient-phone')).toHaveValue(phone);
    await page.screenshot({ path: info.outputPath(`patient-${country.toLowerCase()}-edit-form.png`), fullPage: true });
  }
});
