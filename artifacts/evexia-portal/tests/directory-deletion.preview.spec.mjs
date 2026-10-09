import { test, expect } from '@playwright/test';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');

async function seed(page) {
  await page.goto(base() + '/admin/login');
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return page.evaluate(async () => {
    const a = await import('/src/auth/adminSession.js');
    const tag = crypto.randomUUID().slice(0, 8);
    const hq = await a.headquarterRequest('', { body: { name: `Delete HQ ${tag}`, status: 'active' } });
    const zone = await a.zoneRequest('', { body: { name: `Delete Zone ${tag}`, status: 'active' } });
    const designation = await a.designationRequest('', { body: { name: `Delete designation ${tag}`, shortName: 'MR', status: 'active' } });
    const mr = (await a.mrRequest('', { body: {
      name: `Delete MR ${tag}`, userId: `delete.mr.${tag}`, employeeCode: `DEL-${tag}`,
      dateOfJoining: '2020-01-01', designation_id: designation.id, hq: hq.id, zoneId: zone.id,
      contactRequirement: 'optional', phone: '', email: '', status: 'active',
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark', pincode: '110001',
      city: 'Delhi', state: 'Delhi', country: 'India', paymentLimit: '0.00', doctorDaysLimit: 0,
    } })).record;
    const doctor = await a.doctorRequest('', { body: {
      name: `Delete Doctor ${tag}`, registrationNumber: `DELREG-${tag}`, qualification: 'MBBS',
      mrId: mr.id, phone: '', alternatePhone: '', email: '', contactRequirement: 'optional', dialCountry: 'IN',
      dateOfJoining: null, clinicName: '', invoiceType: 'normal', gstNumber: '', drugLicenceNumber: '',
      orderDiscount: '0.00', daysLimit: 0, paymentLimit: '0.00', status: 'active', pincode: '110001',
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark',
      country: 'India', state: 'Delhi', city: 'Delhi',
    } });
    const patient = await a.patientRequest('', { body: {
      name: `Delete Patient ${tag}`, gender: 'other', phone: '9000000000', dialCountry: 'IN', email: '',
      dateOfBirth: '2000-02-29', doctorId: doctor.id, instructionsLanguage: 'Hindi', status: 'active',
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark',
      pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
    } });
    const balance = await a.openingBalanceRequest('', { body: {
      doctorId: doctor.id, startYear: 2025, endYear: 2026, amount: '25.50', status: 'active',
    } });
    return { doctor, patient, balance, tag };
  });
}

async function directory(page, kind, record) {
  await page.goto(`${base()}/admin/masters/${kind}s`);
  await expect(page.getByRole('heading', { name: `${kind === 'doctor' ? 'Doctor' : 'Patient'} Master`, exact: true })).toBeVisible();
  const filtered = page.waitForResponse(response => response.request().method() === 'GET'
    && response.url().includes(`/admin/${kind}s?`) && new URL(response.url()).searchParams.get('query') === record.name
    && response.status() === 200);
  await page.getByTestId(`input-search-${kind}s`).fill(record.name);
  await filtered;
  const button = page.getByRole('button', { name: `Delete ${record.name}`, exact: true }).filter({ visible: true });
  await expect(button).toBeEnabled();
  return button;
}

for (const mobile of [false, true]) test(`Directory deletion cancellation, retained references and success ${mobile ? 'mobile' : 'desktop'}`, async ({ page }, info) => {
  test.setTimeout(120000);
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const refs = await seed(page);
  await page.evaluate(() => localStorage.setItem('evexia.admin.patients.v1', '[{"id":"PAT-LOCAL","name":"Untouched"}]'));
  for (const kind of ['doctor', 'patient']) {
    const record = refs[kind];
    let requests = 0;
    const listener = req => { if (req.url().includes(`/admin/${kind}s/${record.id}/delete`)) requests++; };
    page.on('request', listener);
    const button = await directory(page, kind, record);
    await button.click();
    await expect(page.getByRole('dialog')).toContainText(/Stored relationships|stored relationships/);
    await page.getByTestId('button-cancel-confirmation').click();
    expect(requests).toBe(0);
    await expect(button).toBeFocused();
    await button.click();
    await page.screenshot({ path: info.outputPath(`${kind}-delete-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Delete ${record.name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /removed from normal use/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh records', exact: true }).first()).toBeFocused();
    expect(requests).toBe(1);
    page.off('request', listener);
    if (kind === 'doctor') {
      await page.goto(`${base()}/admin/masters/patients/${refs.patient.id}`);
      await expect(page.getByTestId('button-save-patient')).toBeVisible();
      await page.getByTestId('tab-patient-care').click();
      await expect(page.getByTestId('select-patient-doctorId')).toHaveValue(new RegExp(refs.doctor.name));
      await page.getByTestId('select-patient-doctorId').click();
      await expect(page.getByRole('option', { name: new RegExp(refs.doctor.name) })).toHaveCount(0);
      await page.getByTestId('select-patient-doctorId').press('Escape');
      await expect(page.getByText(/Doctor unavailable \(deleted\)/)).toBeVisible();
      await page.getByTestId('button-save-patient').click();
      await expect(page.getByRole('heading', { name: 'Patient Master', exact: true })).toBeVisible();
      await page.goto(`${base()}/admin/masters/opening-balances/${refs.balance.id}`);
      await expect(page.locator('#opening-balance-doctor')).toHaveValue(new RegExp(refs.doctor.name));
      await page.locator('#opening-balance-doctor').click();
      await expect(page.getByRole('option', { name: new RegExp(refs.doctor.name) })).toHaveCount(0);
      // The Patient edit advanced its authoritative concurrency version.
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.patients.v1'))).toBe('[{"id":"PAT-LOCAL","name":"Untouched"}]');
});

for (const kind of ['doctor', 'patient']) test(`${kind} deletion guards stale, unavailable and committed lost responses without replay`, async ({ page }) => {
  test.setTimeout(120000);
  const refs = await seed(page);
  const record = refs[kind];
  const pattern = `**/api/v1/admin/${kind}s/${record.id}/delete*`;
  for (const mode of ['stale', 'unavailable', 'lost']) {
    let count = 0;
    const handler = async route => {
      count++;
      if (mode === 'lost') {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
      } else await route.fulfill({ status: mode === 'stale' ? 409 : 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: `${kind}_${mode}`, message: mode === 'stale' ? 'Record changed. Refresh to review.' : 'Service unavailable. Preserve your draft.' } }) });
    };
    await page.route(pattern, handler);
    const button = await directory(page, kind, record);
    await button.click();
    await page.getByTestId('button-confirm-action').click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    expect(count).toBe(1);
    if (mode !== 'unavailable') await expect(page.getByTestId('button-confirm-action')).toBeDisabled();
    await page.getByTestId('button-cancel-confirmation').click();
    await page.unroute(pattern, handler);
    await page.getByRole('button', { name: 'Refresh records', exact: true }).first().click();
    if (mode === 'lost') await expect(page.getByRole('button', { name: `Delete ${record.name}`, exact: true })).toHaveCount(0);
    else await expect(page.getByRole('button', { name: `Delete ${record.name}`, exact: true }).filter({ visible: true })).toBeEnabled();
  }
});

test('Doctor and Patient delete-only staff can confirm without edit or file access', async ({ page, browser }) => {
  test.setTimeout(120000);
  const refs = await seed(page);
  const credentials = await page.evaluate(async tag => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    let role = await roles.createRole({ name: `Delete-only ${tag}`, description: 'Synthetic deletion fixture' });
    role = await roles.setRolePermissions(role.id, ['doctor.delete', 'patient.delete'], role.version);
    const made = await staff.createStaff({ name: `Delete staff ${tag}`, email: `delete-${tag}@example.com`,
      phone: '9876543210', dialCountry: 'IN', status: 'active', role: 'Staff', designation: 'Executive', dateOfJoining: '2020-01-01' });
    await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: true });
    return { userId: made.record.userId, password: made.initial_password };
  }, refs.tag);
  const context = await browser.newContext();
  const clerk = await context.newPage();
  try {
    await clerk.goto(base() + '/admin/login');
    await clerk.getByLabel('Email or username').fill(credentials.userId);
    await clerk.getByLabel('Password', { exact: true }).fill(credentials.password);
    await clerk.getByTestId('button-submit-login').click();
    await expect(clerk.getByTestId('button-admin-profile')).toBeVisible();
    for (const kind of ['patient', 'doctor']) {
      const button = await directory(clerk, kind, refs[kind]);
      await expect(clerk.getByRole('button', { name: /^Edit / })).toHaveCount(0);
      await expect(clerk.getByRole('button', { name: /Dosage History|Payment history/i })).toHaveCount(0);
      await button.click();
      await clerk.getByTestId('button-confirm-action').click();
      await expect(clerk.getByRole('dialog')).toHaveCount(0);
      await expect(clerk.getByRole('button', { name: `Delete ${refs[kind].name}`, exact: true })).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});
