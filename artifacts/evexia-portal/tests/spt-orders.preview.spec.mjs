import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const list = '/admin/orders/spt';
async function login(page, path = list) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}${path}`);
  await expect(page.locator('.spt h1')).toBeVisible();
}
async function choose(page, label, search) {
  const input = page.getByRole('combobox', { name: label, exact: true });
  await input.fill(search);
  await input.press('ArrowDown');
  await input.press('Enter');
  await input.press('Tab');
}
async function addPatient(page, query) {
  await choose(page, 'Patient search', query);
  await expect(page.getByTestId('preview-spt-patient')).toContainText(query);
  await page.getByRole('button', { name: 'Add patient', exact: true }).click();
}
async function noOverflow(page) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth, pageWidth: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('.spt *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > innerWidth + 1 && !el.closest('.admin-table-scroll');
    }).map((el) => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })),
  }));
  expect(geometry.pageWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width + 1);
}

test('SPT mock patient selection, registration, exact amounts, draft resume, saved review and reload reset', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const requests = [];
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (request) => {
    if (/\/api\/.*(?:doctors|mrs|patients|orders)/i.test(request.url())) requests.push(request.url());
  });
  await login(page);
  await expect(page.getByTestId('row-spt-demo-spt-1')).toContainText('₹2,750.50');
  await page.getByLabel('Status', { exact: true }).selectOption('Draft');
  await expect(page.getByTestId('row-spt-demo-spt-1')).toHaveCount(0);
  await page.getByLabel('Search orders').fill('not-a-demo-order');
  await expect(page.getByTestId('empty-spt-orders')).toContainText('No orders match');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('link', { name: 'Add Order', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('status-spt-errors')).toContainText('Doctor');
  await expect(page.getByRole('combobox', { name: 'Doctor', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await choose(page, 'Doctor', 'Mira');
  await choose(page, 'MR', 'Dev');
  await addPatient(page, 'DEMO-PT-001');
  await expect(page.getByTestId('text-spt-total')).toContainText('₹0.00');
  await page.getByRole('combobox', { name: 'Patient search' }).fill('Asha');
  await expect(page.getByRole('listbox', { name: 'Patient search' })).toContainText('No matches');
  await page.keyboard.press('Escape');
  await addPatient(page, 'Rohan');
  await page.getByLabel('Amount for Asha Example').fill('0.10');
  await page.getByLabel('Amount for Rohan Sample').fill('0.20');
  await expect(page.getByTestId('text-spt-total')).toContainText('₹0.30');
  await page.getByRole('textbox', { name: 'Remarks', exact: true }).fill('Retain this fictional note');
  await page.getByRole('button', { name: 'Register Patient', exact: true }).click();
  await expect(page.getByLabel('Patient name', { exact: true })).toBeFocused();
  await page.getByLabel('Patient name', { exact: true }).fill('Cancelled Demo');
  await page.getByRole('button', { name: 'Cancel registration' }).click();
  await expect(page.getByRole('button', { name: 'Register Patient', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Remarks', exact: true })).toHaveValue('Retain this fictional note');
  await page.getByRole('button', { name: 'Register Patient', exact: true }).click();
  await page.getByLabel('Patient name', { exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Register Patient', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Register Patient', exact: true }).click();
  await page.getByRole('button', { name: 'Create demo patient' }).click();
  await expect(page.getByLabel('Patient name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Patient name', { exact: true }).fill('New Fictional Patient');
  await page.getByLabel('Gender', { exact: true }).selectOption('Other');
  await page.getByLabel('Age', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Create demo patient' }).click();
  await expect(page.getByTestId('preview-spt-patient')).toContainText('DEMO-PT-005');
  await expect(page.getByTestId('preview-spt-patient')).toContainText('35');
  await page.getByRole('button', { name: 'Add patient', exact: true }).click();
  await page.getByLabel('Amount for New Fictional Patient').fill('1.25');
  await expect(page.getByTestId('text-spt-total')).toContainText('₹1.55');
  await page.getByRole('button', { name: 'Remove Rohan Sample' }).click();
  await expect(page.getByTestId('text-spt-total')).toContainText('₹1.35');
  for (const amount of ['-1', 'not money', 'Infinity', '1.001']) {
    await page.getByLabel('Amount for Asha Example').fill(amount);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Amount for Asha Example')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('text-spt-total')).toContainText('₹1.25');
  }
  await page.getByLabel('Amount for Asha Example').fill('');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('status-spt-feedback')).toContainText('saved as Draft');
  await page.getByTestId('link-spt-open-demo-spt-3').click();
  await expect(page.getByLabel('Amount for Asha Example')).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Remarks', exact: true })).toHaveValue('Retain this fictional note');
  await expect(page.getByLabel('Amount for New Fictional Patient')).toHaveValue('1.25');
  await page.getByLabel('Amount for Asha Example').fill('0.10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('status-spt-feedback')).toContainText('No real order was submitted');
  await expect(page.getByTestId('row-spt-demo-spt-3')).toContainText('Saved');
  await expect(page.getByTestId('row-spt-demo-spt-3')).toContainText('₹1.35');
  await page.getByTestId('link-spt-open-demo-spt-3').click();
  await expect(page.getByRole('heading', { name: 'Review DEMO-SPT-0003' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Remarks', exact: true })).toHaveValue('Retain this fictional note');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('spt-saved-review.png'), fullPage: true });
  await page.reload();
  await expect(page.getByTestId('status-spt-missing')).toContainText('resets');
  await page.getByRole('link', { name: 'All orders', exact: true }).click();
  await expect(page.getByTestId('row-spt-demo-spt-3')).toHaveCount(0);
  await expect(page.getByTestId('row-spt-demo-spt-1')).toBeVisible();
  expect(requests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('SPT cold direct routes fit mobile tablet desktop and enlarged text in light and dark', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await login(page, `${list}/new`);
  for (const appearance of ['light', 'dark']) {
    await page.evaluate((mode) => localStorage.setItem('evexia.admin.appearance', mode), appearance);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Add Order', exact: true })).toBeVisible();
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
      await choose(page, 'Doctor', 'Mira');
      await page.getByRole('button', { name: 'Register Patient', exact: true }).click();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Cancel registration' }).click();
    }
    await addPatient(page, 'Asha');
    await page.setViewportSize({ width: 360, height: 1000 });
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('.spt *')].map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
      sizes.forEach(([el, size]) => el.style.setProperty('font-size', `${size * 2}px`, 'important'));
    });
    await noOverflow(page);
    const table = page.getByRole('region', { name: 'Selected patients', exact: true });
    await table.focus();
    await expect(table).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`spt-${appearance}-enlarged-mobile.png`), fullPage: true });
  }
  await page.goto(`${base()}${list}`);
  await expect(page.getByRole('heading', { name: 'SPT', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('spt-mobile-listing.png'), fullPage: true });
});
