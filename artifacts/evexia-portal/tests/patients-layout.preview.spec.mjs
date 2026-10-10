import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { seedPatientRelationships } from './helpers/patientFixture.mjs';
import { enlargePatientText, expectPatientFits, keyboardReach } from './helpers/patientLayout.mjs';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/patients';
const longMessage = 'Synthetic server validation: review the assigned Doctor, MR and Zone before saving. '.repeat(5)
  + 'RelationshipReference'.repeat(12);
const headers = ['Patient ID','Patient Name','Gender','Phone No.','Email ID','Date of Birth','Doctor ID','Doctor Registration Number','Instructions Language','Status','Address Line 1','Address Line 2','Landmark','Pincode','City','State','Country','Dial Country'];
let refs, saved;

test.beforeAll(async ({ browser, browserName }) => {
  console.log(`Patient layout engine: ${browserName} ${browser.version()}`);
  const page = await browser.newPage();
  refs = await seedPatientRelationships(page);
  saved = await page.evaluate(async ({ doctorId, tag }) => (await import('/src/services/serverPatients.js')).createPatient({
    name: `Synthetic enlarged-text Patient ${tag}`, gender: 'prefer not to say', phone: '123456789', dialCountry: 'AE', email: '',
    dateOfBirth: '2000-02-29', doctorId, instructionsLanguage: 'Hindi', status: 'active',
    addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Synthetic landmark',
    pincode: '110001', country: 'India', state: 'Delhi', city: 'Delhi',
  }), { doctorId: refs.doctor.id, tag: refs.tag });
  await page.close();
});

for (const [theme, appearance] of [['classic', 'light'], ['modern', 'dark']]) {
  test(`Patient desktop care row ${theme}/${appearance} and enlarged dropdown`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await authenticateAdmin(page);
    await page.goto(base() + path);
    await expect(page.getByTestId('button-add-patient')).toBeVisible();
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    await page.goto(base() + path + '/' + saved.id);
    await expect(page.getByTestId('input-patient-name')).toHaveValue(saved.name);
    await page.getByTestId('tab-patient-care').click();
    const tops = await page.locator('.patient-form__care-grid > .mr-form__field').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops).toHaveLength(3);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const doctor = page.getByTestId('select-patient-doctorId');
    await doctor.click();
    await expect(page.getByRole('option', { name: refs.doctor.name, exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath('desktop-care-open.png'), fullPage: true });
    await enlargePatientText(page, '.patient-form');
    await expectPatientFits(page, '.patient-form');
    await page.screenshot({ path: info.outputPath('desktop-care-enlarged.png'), fullPage: true });
    await doctor.press('Escape');
    await expect(doctor).toHaveValue(refs.doctor.name);
  });
}

for (const width of [390, 768]) for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
  test(`Patient 200% text ${width}px ${theme}/${appearance}: form, reviews and menu`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    await authenticateAdmin(page);
    await page.goto(base() + path);
    await expect(page.getByTestId('button-add-patient')).toBeVisible();
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    await page.goto(base() + path + '/' + saved.id);
    await expect(page.getByTestId('input-patient-name')).toHaveValue(saved.name);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    const root = '.patient-form';
    const originalSize = await page.getByTestId('input-patient-phone').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    await enlargePatientText(page, root);
    expect(await page.getByTestId('input-patient-phone').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(originalSize * 2);

    const phone = page.getByTestId('input-patient-phone'), country = page.getByLabel('Phone country code');
    for (const code of ['GB', 'US', 'IN', 'AE']) {
      await country.selectOption(code);
      await expect(country).toHaveValue(code);
      await expect(phone).toHaveValue('123456789');
      await expectPatientFits(page, root);
    }
    await phone.fill('1');
    await page.getByTestId('button-save-patient').click();
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toHaveAttribute('aria-describedby', /patient-phone-error/);
    await expect(page.locator('#patient-phone-error')).toHaveText('Enter a valid national phone number for United Arab Emirates.');
    await enlargePatientText(page, root);
    await expectPatientFits(page, root);
    await page.screenshot({ path: info.outputPath('identity-200-percent.png'), fullPage: true });
    await phone.fill('123456789');

    // Bound layout fixtures exercise paging and retained relationship labels
    // without creating fifty MR credentials or weakening server limits.
    const offsets = [];
    await page.route('**/api/v1/admin/patients/references?*', (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
      offsets.push(offset);
      const doctor = { ...refs.doctor, usable: true, mrName: 'Synthetic MR with a long readable relationship label',
        zoneName: 'Synthetic Zone with a long readable relationship label', name: 'Synthetic Doctor '.padEnd(180, '界') };
      return route.fulfill({ json: { items: [doctor], total: 51, offset, limit: 50 } });
    });
    await page.getByTestId('tab-patient-care').click();
    // The hidden care panel mounted before interception. Change its search to
    // explicitly load the layout-only reference page instead of cached data.
    const doctorSelect = page.getByTestId('select-patient-doctorId');
    await doctorSelect.click();
    await doctorSelect.fill('Synthetic');
    await expect.poll(() => offsets.length).toBeGreaterThan(0);
    await expect(doctorSelect).toBeEnabled();
    await expect(page.getByRole('option', { name: /Synthetic Doctor/ })).toBeVisible();
    await doctorSelect.press('ArrowDown');
    await doctorSelect.press('Enter');
    await expect(page.locator('#patient-doctor-selection')).toContainText('Synthetic Doctor '.padEnd(180, '界'));
    await expect(doctorSelect).toHaveAttribute('aria-describedby', /patient-doctor-selection/);
    await expect(page.locator('#patient-doctor-help')).toContainText('Synthetic MR');
    await doctorSelect.click();
    const next = page.getByRole('button', { name: 'Next Doctors', exact: true });
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await keyboardReach(page, doctorSelect, next);
    await page.keyboard.press('Enter');
    await expect.poll(() => offsets).toContain(50);
    await expect(doctorSelect).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Previous Doctors', exact: true })).toHaveAttribute('aria-disabled', 'false');
    await page.getByRole('button', { name: 'Previous Doctors', exact: true }).click();
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByRole('option', { name: /Synthetic Doctor/ })).toBeVisible();
    await enlargePatientText(page, root);
    await page.screenshot({ path: info.outputPath('relationships-200-percent.png'), fullPage: true });
    await expectPatientFits(page, root);
    await doctorSelect.press('Escape');

    await page.route('**/api/v1/admin/patients/postal/400001*', (route) => route.fulfill({ json: {
      choices: [{ city: 'Mumbai', state: 'Maharashtra', country: 'India' }, { city: 'Fort', state: 'Maharashtra', country: 'India' }], message: '',
    } }));
    await page.getByTestId('tab-patient-address').click();
    await page.getByTestId('input-patient-pincode').fill('400001');
    const pin = page.getByLabel('PIN locations', { exact: true });
    await expect(pin).toBeVisible();
    await keyboardReach(page, page.getByTestId('input-patient-pincode'), pin);
    await pin.selectOption('1');
    await expect(page.getByTestId('input-patient-city')).toHaveValue('Fort');
    await expect(page.getByTestId('input-patient-state')).toHaveValue('Maharashtra');
    await expect(page.locator('#patient-pin-selection')).toHaveText('Fort, Maharashtra, India');
    await expect(pin).toHaveAttribute('aria-describedby', 'patient-pin-selection');
    await enlargePatientText(page, root);
    await page.screenshot({ path: info.outputPath('pin-200-percent.png'), fullPage: true });
    await expectPatientFits(page, root);
    await page.route(`**/api/v1/admin/patients/${saved.id}/edit?*`, (route) => route.fulfill({ status: 422, json: { error: { code: 'patient_validation', message: longMessage } } }));
    await page.getByTestId('button-save-patient').click();
    await expect(page.getByTestId('error-patient-save')).toContainText(longMessage);
    await enlargePatientText(page, root);
    await expectPatientFits(page, root);
    await keyboardReach(page, page.getByTestId('tab-patient-address'), page.getByTestId('button-refresh-patient-save'));
    await page.screenshot({ path: info.outputPath('server-error-200-percent.png'), fullPage: true });

    await page.goto(base() + '/admin/masters/import/patient');
    await expect(page.getByTestId('input-patient-import')).toBeAttached();
    const valid = ['', `Valid synthetic ${refs.tag}`.padEnd(180, '界'), 'Female', '9000000000', '', '2001-01-01', '', refs.doctor.registrationNumber, 'Hindi', 'active', 'Street', '', 'Landmark', '110001', 'Delhi', 'Delhi', 'India', 'IN'];
    const invalid = [...valid]; invalid[1] = 'Invalid synthetic '.padEnd(180, '配'); invalid[3] = '1'; invalid[7] = 'MissingSyntheticDoctor';
    for (const format of ['csv', 'xlsx']) {
      const rows = [headers, valid, invalid];
      const buffer = format === 'csv' ? Buffer.from(rows.map((row) => row.join(',')).join('\n')) :
        execFileSync('python3', ['-c', 'import sys,json,io; from openpyxl import Workbook; w=Workbook(); [w.active.append(r) for r in json.load(sys.stdin)]; b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(rows) });
      await page.getByTestId('input-patient-import').setInputFiles({
        name: `synthetic-${'long-filename-'.repeat(12)}.${format}`,
        mimeType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer,
      });
      await page.getByTestId('button-review-patient-import').click();
      const report = page.getByTestId('patient-excel-report');
      await expect(report).toContainText('1 valid');
      await expect(report).toContainText('1 invalid');
      await expect(page.getByTestId('button-confirm-patient-import')).toBeDisabled();
      const details = report.locator('details').first();
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await enlargePatientText(page, '.excel-import--patient');
      await expectPatientFits(page, '.excel-import--patient');
      await keyboardReach(page, page.locator('.excel-import__back'), page.getByTestId('input-patient-import'));
      await keyboardReach(page, page.getByTestId('input-patient-import'), page.getByTestId('button-review-patient-import'));
      await page.screenshot({ path: info.outputPath(`${format}-review-200-percent.png`), fullPage: true });
    }
    await page.route('**/api/v1/admin/patients/import/review?*', (route) => route.fulfill({ status: 422, json: { error: { code: 'patient_validation', message: longMessage } } }));
    await page.getByTestId('button-review-patient-import').click();
    await expect(page.getByRole('alert')).toContainText(longMessage);
    await enlargePatientText(page, '.excel-import--patient');
    await expectPatientFits(page, '.excel-import--patient');
    await page.screenshot({ path: info.outputPath('import-error-200-percent.png'), fullPage: true });

    // Real menu interactions in every engine; outside clicks cannot use roles
    // hidden by Radix's modal menu. Dismiss via coordinates instead.
    await page.goto(base() + path);
    const trigger = page.getByTestId('button-export-patients');
    await expect(trigger).toBeEnabled();
    await trigger.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'CSV', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: info.outputPath('export-focus-return.png') });
  });
}
