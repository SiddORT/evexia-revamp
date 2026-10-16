import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const open = (page, path) => page.goto(`${base()}${path}`);
const nav = (page, name) => page.getByRole('navigation', { name: 'Doctor navigation', exact: true }).getByRole('link', { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  // Routing infrastructure only. No real auth or business API is needed.
  await page.route('**/api/v1/portal/resolve?*', (route) => route.fulfill({ json: { role: null } }));
  await page.addInitScript(() => {
    window.doctorWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      window.doctorWrites.push(key);
      return original.call(this, key, value);
    };
  });
  page.on('request', (request) => {
    if (/\/api\//.test(request.url()) && !/\/api\/v1\/portal\/resolve\?/.test(request.url())) throw new Error(`Unexpected business/auth traffic: ${request.method()} ${request.url()}`);
  });
  page.on('pageerror', (error) => { throw error; });
});
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    const writes = await page.evaluate(() => window.doctorWrites || []);
    expect(writes.filter((key) => !['evexia.admin.theme', 'evexia.admin.appearance', 'evexia.admin.dateFormat', 'evexia.admin.timeZone', 'evexia.admin.clock'].includes(key))).toEqual([]);
  }
});

test('Doctor entry, fake credential preview, mock recovery and safe cold routes', async ({ page }) => {
  await open(page, '/doctor');
  await expect(page.getByRole('heading', { name: 'IMMUNO PORTAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to demo', exact: true }).click();
  await expect(page.locator('.dr-field__error')).toHaveCount(2);
  await page.getByLabel('Email', { exact: true }).fill('doctor@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('demo-only-pass');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Continue to demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good day, Dr. Sen' })).toBeVisible();
  await expect(page.locator('.dr-notice-bar')).toContainText('held in memory');
  await open(page, '/doctor/forgot-password');
  await page.getByLabel('Fictional email').fill('doctor@example.invalid');
  await page.getByRole('button', { name: 'Show acknowledgement' }).click();
  await expect(page.getByTestId('forgot-ack')).toContainText('no email was sent and no password was changed');
  await page.getByRole('link', { name: 'Back to login' }).click();
  await page.getByTestId('button-enter-demo').click();
  await expect(page).toHaveURL(/\/doctor\/home$/);
  for (const [path, title] of [['patients/missing', 'Patient not found'], ['tests/missing', 'Test record not found'], ['doses/missing', 'Dose not found'], ['orders/missing', 'Order not found'], ['unknown/path', 'Page not found']]) {
    await open(page, `/doctor/${path}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  await page.route('**/api/v1/portal/resolve?*', (route) => route.fulfill({ json: { role: 'mr' } }));
  await open(page, '/doctor/home');
  await expect(page.getByRole('heading', { name: 'This hostname opens the MR portal' })).toBeVisible();
});

test('patient → test → manual dose journey updates history without seeding treatment', async ({ page }) => {
  await open(page, '/doctor/home');
  await page.getByRole('link', { name: 'Add patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Sample River');
  await page.getByLabel('Age (years)').fill('31');
  await page.getByLabel('Email (fictional)').fill('river@example.invalid');
  await page.getByLabel('Care notes (optional)').fill('Sample initial visit note.');
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sample River', exact: true })).toBeVisible();
  await expect(page.getByText('No tests, doses or orders yet.', { exact: false })).toBeVisible();
  const patientPath = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Record test', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Patient', exact: true })).toHaveValue('Sample River');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Allergen', { exact: true }).fill('Sample pollen');
  await page.getByLabel('Result value').fill('2');
  await page.getByLabel('Positive control', { exact: false }).fill('5');
  await page.getByLabel('Negative control', { exact: false }).fill('0');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.dr-review')).toContainText('Sample River');
  await page.getByRole('button', { name: 'Save demo test', exact: true }).click();
  await expect(page.locator('.dr-printable')).toContainText('SAMPLE TEST REPORT');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.dr-sidebar')).not.toBeVisible();
  await expect(page.locator('.dr-printable')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.locator('.dr-printable').getByRole('link', { name: 'Sample River', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule dose', exact: true }).click();
  await page.getByLabel('Sample dose details', { exact: true }).fill('Sample vial A · 0.1 mL · manual fictional entry');
  await page.getByRole('button', { name: 'Save scheduled dose' }).click();
  await page.getByRole('button', { name: 'Mark demo dose completed' }).click();
  await expect(page.getByText('This dose is recorded as completed (demo). No further actions.')).toBeVisible();
  await page.getByRole('link', { name: 'Sample River', exact: true }).click();
  await expect(page.getByText('Recorded demo completion', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Sample allergy test recorded', { exact: true })).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe(patientPath);
  await page.reload();
  await expect(page.getByText('Patient not found', { exact: true })).toBeVisible();
});

test('draft order → placement → exact partial/full ledger and print acknowledgement', async ({ page }) => {
  await open(page, '/doctor/orders/new');
  await page.getByRole('combobox', { name: 'Patient', exact: true }).focus();
  await page.getByRole('combobox', { name: 'Patient', exact: true }).fill('Avery');
  await page.getByRole('option', { name: 'Avery Bloom' }).click();
  await page.getByRole('combobox', { name: 'Product 1', exact: true }).fill('diary');
  await page.getByRole('option', { name: /Sample care diary/ }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.getByText('Enter a positive whole number up to 999.')).toBeVisible();
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.locator('.dr-review')).toContainText('555.75');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place draft as demo order' })).toBeVisible();
  await page.getByRole('button', { name: 'Place draft as demo order' }).click();
  await page.getByRole('link', { name: 'Go to payments', exact: true }).click();
  const row = page.locator('.dr-row--static').filter({ hasText: '555.75' });
  await row.getByRole('button', { name: 'Pay demo', exact: true }).click();
  await page.getByLabel('Amount in INR', { exact: false }).fill('1.001');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/\/doctor\/payments$/);
  await expect(page.getByLabel('Amount in INR', { exact: false })).toHaveValue('1.001');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Enter a non-negative amount with at most two decimal places.')).toBeVisible();
  await page.getByLabel('Amount in INR', { exact: false }).fill('555.76');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Amount cannot exceed the balance', { exact: false })).toBeVisible();
  await page.getByLabel('Amount in INR', { exact: false }).fill('100.10');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm demo payment' }).click();
  await expect(row).toContainText('455.65');
  await expect(row).toContainText('Partially paid');
  await expect(page.getByTestId('payment-ack')).toContainText('No real payment was made');
  await row.getByRole('button', { name: 'Pay demo', exact: true }).click();
  await page.getByRole('button', { name: 'Fill full balance' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm demo payment' }).click();
  await expect(row).toContainText('Paid');
  await expect(row).toContainText('Fulfilment: Placed');
  await expect(row.getByRole('button', { name: 'Pay demo', exact: true })).toBeDisabled();
});

test('MR timeline, report filters/recovery, clinic selection, feedback and print-after-navigation', async ({ page }) => {
  await open(page, '/doctor/mr');
  await expect(page.getByText('Current mapping', { exact: true })).toBeVisible();
  await expect(page.getByText('Previous assignment: Nila Rowan', { exact: true })).toBeVisible();
  await nav(page, 'Reports');
  await page.getByLabel('Report', { exact: true }).selectOption('doses');
  await page.getByLabel('Status', { exact: true }).selectOption('Completed');
  await expect(page.locator('.dr-printable tbody tr')).toHaveCount(1);
  await expect(page.locator('.dr-printable')).toContainText('Recorded demo completion');
  await page.getByLabel('From', { exact: true }).fill('2026-12-31');
  await page.getByLabel('To', { exact: true }).fill('2026-01-01');
  await expect(page.getByRole('alert')).toContainText('From date');
  await page.getByLabel('From', { exact: true }).fill('');
  await page.getByLabel('To', { exact: true }).fill('');
  await nav(page, 'Feedback');
  await expect(page.getByText('Displayed average:').locator('..')).toContainText('4.7');
  await page.getByRole('checkbox').last().uncheck();
  await expect(page.locator('.dr-sheet__avg')).toContainText('4.5');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.dr-printable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Doctor navigation', exact: true })).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('tab', { name: 'System Feedback' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Suggestion');
  await page.getByLabel('Message', { exact: true }).fill('A sample portal feedback message.');
  await page.getByRole('button', { name: 'Save feedback locally' }).click();
  await expect(page.getByRole('status')).toContainText('not sent to support');
  await nav(page, 'Patients');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('dirty drafts survive canceled navigation, back traversal and canceled Exit demo', async ({ page }) => {
  await open(page, '/doctor/home');
  await nav(page, 'Patients');
  await page.getByRole('link', { name: 'Add patient', exact: true }).click();
  await page.getByLabel('Full name').fill('Unsaved sample');
  await nav(page, 'Orders');
  await expect(page.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Unsaved sample');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.locator('.dr-profile > button').click();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Unsaved sample');
  await nav(page, 'Orders');
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
});

for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
  test(`${theme}/${appearance} cold routes, widths, mobile keyboard, enlarged text and preferences`, async ({ page }) => {
    await page.addInitScript(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      for (const path of ['/doctor', '/doctor/home', '/doctor/patients', '/doctor/tests/new', '/doctor/orders/new', '/doctor/feedback']) {
        await open(page, path);
        await expect(page.locator('.dr-root')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.dr-root')).toHaveAttribute('data-admin-appearance', appearance);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      }
    }
    await open(page, '/doctor/home');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Doctor navigation panel' })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    await page.locator('.dr-profile > button').click();
    await page.getByRole('radio', { name: appearance === 'dark' ? 'Light' : 'Dark', exact: true }).check();
    await expect(page.locator('.dr-root')).toHaveAttribute('data-admin-appearance', appearance === 'dark' ? 'light' : 'dark');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll('.dr-root *')];
      const sizes = elements.map((node) => getComputedStyle(node).fontSize);
      elements.forEach((node, index) => { node.style.fontSize = `${parseFloat(sizes[index]) * 2}px`; });
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
