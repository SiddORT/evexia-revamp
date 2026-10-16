import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
let accounts;
async function login(page, account = accounts[0]) {
  await page.goto(base() + '/mr');
  await page.getByLabel('Email or username').fill(account.username);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('meter-sales')).toBeVisible();
}
async function nav(page, name) {
  if (await page.getByTestId('button-mobile-menu').isVisible()) {
    if (await page.getByTestId('button-mobile-menu').getAttribute('aria-expanded') !== 'true') await page.getByTestId('button-mobile-menu').click();
  }
  await page.getByTestId(`link-nav-${name}`).click();
  await expect(page.getByTestId('page-mr-home')).toBeVisible();
}
async function settings(page) {
  await page.getByTestId('button-profile-menu').click();
  await page.getByTestId('link-settings').click();
  await expect(page.getByTestId('form-mr-password')).toBeVisible();
}
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await authenticateAdmin(page);
    await page.goto(base() + '/admin/masters/mrs');
    await expect(page.getByTestId('button-admin-profile')).toBeVisible();
    accounts = await page.evaluate(async () => {
      const s = await import(new URL('/src/auth/adminSession.js', location.href).href);
      const suffix = crypto.randomUUID().slice(0, 8);
      const hq = await s.headquarterRequest('', { body: { name: `Workspace HQ ${suffix}`, status: 'active' } });
      const zone = await s.zoneRequest('', { body: { name: `Workspace Zone ${suffix}`, status: 'active' } });
      const designation = await s.designationRequest('', { body: { name: `Workspace MR ${suffix}`, shortName: 'MR', status: 'active' } });
      const list = [];
      for (let n = 0; n < 2; n++) {
        const username = `mr.mock.${suffix}.${n}`;
        const created = await s.mrRequest('', { body: {
          name: `Synthetic Workspace MR ${suffix} ${n}`, userId: username, employeeCode: `MOCK-${suffix}-${n}`,
          contactRequirement: 'optional', phone: '', email: '', hq: hq.id, zoneId: zone.id,
          dateOfJoining: '2020-01-01', designation_id: designation.id, status: 'active',
          addressLine1: 'Synthetic address', landmark: 'Synthetic landmark', pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
          paymentLimit: '0.00', doctorDaysLimit: 0,
        } });
        list.push({ username, password: created.credentials.password });
      }
      await s.logoutAdmin();
      return list;
    });
  } finally { await page.close(); }
});

test('MR fictional journey: onboarding, draft, placement, advance, partial and full without business traffic or storage', async ({ page }, info) => {
  test.setTimeout(150000);
  await login(page);
  const forbidden = [];
  const privateConsole = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/auth/') && !url.pathname.includes('/portal-host')) forbidden.push(url.pathname);
  });
  page.on('console', (message) => {
    if (/(Dr\. Fiction Journey|journey@example\.test|0000000000|Fictional address)/i.test(message.text())) privateConsole.push(message.text());
  });
  const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const initial = await page.getByTestId('stat-achieved-sales').innerText();
  await page.getByTestId('link-shortcut-onboard').click();
  await page.getByTestId('button-doctor-next').click();
  await expect(page.getByTestId('input-doctor-name')).toBeFocused();
  await expect(page.getByRole('alert').first()).toContainText('required');
  await page.getByTestId('input-doctor-name').fill('Dr. Fiction Journey');
  await page.getByTestId('input-doctor-qualification').fill('MD');
  await page.getByTestId('input-doctor-registration').fill('DEMO-JOURNEY');
  await page.getByTestId('button-doctor-next').click();
  await page.getByTestId('input-doctor-clinic').fill('Fiction Journey Clinic');
  await page.getByTestId('input-doctor-phone').fill('0000000000');
  await page.getByTestId('input-doctor-email').fill('journey@example.test');
  await page.getByTestId('button-doctor-next').click();
  await page.getByTestId('input-doctor-address').fill('Fictional address, Demo City');
  await page.getByTestId('button-doctor-next').click();
  await expect(page.getByText('You (fixed)', { exact: true })).toBeVisible();
  await page.getByTestId('button-doctor-save').click();
  await expect(page.getByTestId('heading-mr-page')).toHaveText('Dr. Fiction Journey');
  await expect(page.getByTestId('text-flash')).toContainText('onboarded');
  await page.getByRole('link', { name: 'Place order', exact: true }).click();
  await expect(page.getByTestId('select-order-doctor')).toHaveValue(/demo-doctor-/);
  await page.getByTestId('button-order-next').click();
  await page.getByTestId('select-order-product').selectOption('demo-kit');
  await page.getByTestId('input-order-quantity').fill('1.5');
  await page.getByTestId('button-add-item').click();
  await expect(page.getByRole('alert')).toContainText('positive whole');
  await page.getByTestId('input-order-quantity').fill('3');
  await page.getByTestId('button-add-item').click();
  await page.getByTestId('button-order-next').click();
  await expect(page.getByTestId('text-review-total')).toHaveText('₹3,751.50');
  await expect(page.getByTestId('patient-restricted')).toContainText('Patient details restricted');
  await page.getByTestId('button-save-draft').click();
  const draftPath = new URL(page.url()).pathname;
  await expect(page.getByTestId('text-order-total')).toHaveText('₹3,751.50');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByTestId('link-nav-home').click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByTestId('page-mr-home')).toBeHidden();
  await page.unroute('**/api/v1/auth/me');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(page.getByTestId('stat-achieved-sales')).toHaveText(initial);
  await nav(page, 'orders');
  await page.getByRole('link', { name: draftPath.split('/').at(-1), exact: true }).click();
  await expect(page.getByTestId('text-order-total')).toHaveText('₹3,751.50');
  await nav(page, 'home');
  await expect(page.getByTestId('stat-achieved-sales')).toHaveText(initial);
  await expect(page.getByTestId('badge-onboarding')).toBeVisible();
  await nav(page, 'orders');
  await page.getByRole('link', { name: draftPath.split('/').at(-1), exact: true }).click();
  await page.getByTestId('button-place-draft').click();
  await expect(page.getByTestId('text-flash')).toContainText('counts toward sales');
  await nav(page, 'home');
  await expect(page.getByTestId('stat-achieved-sales')).toHaveText('₹60,253.50');
  await expect(page.getByTestId('badge-first-order')).toHaveCount(1);
  await nav(page, 'payments');
  await page.getByTestId('link-add-payment').click();
  await page.getByTestId('select-payment-doctor').selectOption({ label: 'Dr. Fiction Journey' });
  await page.getByTestId('input-payment-amount').fill('100.001');
  await page.getByTestId('button-payment-review').click();
  await expect(page.getByRole('alert')).toContainText('two decimals');
  await page.getByTestId('input-payment-amount').fill('100.01');
  await page.getByTestId('button-payment-review').click();
  await expect(page.getByTestId('payment-review')).toContainText('Unapplied advance credit');
  await page.getByTestId('button-payment-confirm').dblclick();
  await expect(page.getByTestId('payment-ack')).toContainText('No real money moved');
  await page.getByRole('link', { name: 'Payment history' }).click();
  await expect(page.locator('[data-testid^="row-payment-"]')).toHaveCount(3);
  await page.getByTestId('link-add-payment').click();
  await page.getByTestId('button-kind-partial').click();
  await page.getByTestId('select-payment-doctor').selectOption({ label: 'Dr. Fiction Journey' });
  await page.getByTestId('select-payment-order').selectOption(draftPath.split('/').at(-1));
  await expect(page.getByTestId('text-payable-balance')).toContainText('₹3,751.50');
  await page.getByTestId('input-payment-amount').fill('3751.50');
  await page.getByTestId('button-payment-review').click();
  await expect(page.getByRole('alert')).toContainText('below the balance');
  await page.getByTestId('input-payment-amount').fill('1250.25');
  await page.getByTestId('button-payment-review').click();
  await page.getByTestId('button-payment-confirm').click();
  await expect(page.getByTestId('payment-ack')).toBeVisible();
  await page.getByRole('link', { name: 'Payment history' }).click();
  await page.getByTestId('link-add-payment').click();
  await page.getByTestId('button-kind-full').click();
  await page.getByTestId('select-payment-doctor').selectOption({ label: 'Dr. Fiction Journey' });
  await page.getByTestId('select-payment-order').selectOption(draftPath.split('/').at(-1));
  await expect(page.getByTestId('input-payment-amount')).toHaveValue('2501.25');
  await expect(page.getByTestId('input-payment-amount')).toHaveAttribute('readonly', '');
  await page.getByTestId('button-payment-review').click();
  await page.getByTestId('button-payment-confirm').click();
  await expect(page.getByTestId('payment-ack')).toContainText('₹2,501.25');
  await nav(page, 'orders');
  await expect(page.locator(`[data-testid="row-order-${draftPath.split('/').at(-1)}"]`)).toContainText('Paid');
  await nav(page, 'home');
  await expect(page.getByTestId('stat-collections')).toHaveText('₹15,351.51');
  await expect(page.getByTestId('stat-outstanding')).toHaveText('₹46,502.00');
  await expect(page.getByTestId('stat-achieved-sales')).toHaveText('₹60,253.50');
  expect(forbidden).toEqual([]);
  expect(privateConsole).toEqual([]);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore);
  await page.screenshot({ path: info.outputPath('mr-dashboard-desktop.png'), fullPage: true });
  await page.reload();
  await expect(page.getByTestId('stat-achieved-sales')).toHaveText(initial);
  await expect(page.getByTestId('badge-onboarding')).toHaveCount(0);
});

test('MR appearance, keyboard, responsive and guarded forms remain reachable without patient destinations', async ({ page }, info) => {
  test.setTimeout(300000);
  await login(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const theme of ['classic', 'modern']) {
      for (const appearance of ['light', 'dark']) {
        await settings(page);
        await page.getByTestId(`button-theme-${theme}`).click();
        await page.getByTestId(`button-appearance-${appearance}`).click();
        await expect(page.locator('.mrw')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.mrw')).toHaveAttribute('data-admin-appearance', appearance);
        for (const name of ['home', 'doctors', 'orders', 'targets', 'payments']) {
          await nav(page, name);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        }
        await page.screenshot({ path: info.outputPath(`mr-${width}-${theme}-${appearance}.png`), fullPage: true });
      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nav(page, 'home');
  await expect(page.locator('.mrw-meter__fill')).toHaveCSS('animation-name', 'none');
  await page.setViewportSize({ width: 390, height: 950 });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mrw *')].map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
    rows.forEach(([el, size]) => { el.style.fontSize = `${size * 2}px`; });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('mr-enlarged-text.png'), fullPage: true });
  await page.evaluate(() => document.querySelectorAll('.mrw *').forEach((el) => el.style.removeProperty('font-size')));
  await page.getByTestId('button-profile-menu').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('link-settings')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('button-mr-signout')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('button-profile-menu')).toBeFocused();
  await page.getByTestId('link-shortcut-onboard').click();
  await page.getByTestId('input-doctor-name').fill('Unsaved fictional name');
  page.once('dialog', (d) => d.dismiss());
  await nav(page, 'orders');
  await expect(page.getByTestId('input-doctor-name')).toHaveValue('Unsaved fictional name');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('link-doctor-cancel').click();
  await expect(page.getByTestId('input-search-doctors')).toBeVisible();
  // Direct navigation uses the actual refresh-cookie MR boundary.
  for (const path of ['/mr/doctors/demo-doctor-a', '/mr/orders/demo-order-c', '/mr/payments/demo-payment-a', '/mr/targets', '/mr/settings']) {
    await page.goto(base() + path);
    await expect(page.getByTestId('heading-mr-page')).toBeVisible();
  }
  await page.goto(base() + '/mr/patients');
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
  expect(await page.locator('a[href*="patient"], a[href^="/admin"], input[name*="patient"]').count()).toBe(0);
  await page.goto(base() + '/mr/orders/unknown');
  await expect(page.getByText('Order not found', { exact: true })).toBeVisible();
  await page.goto(base() + '/mr/doctors/unknown');
  await expect(page.getByText('Doctor not found', { exact: true })).toBeVisible();
  await page.goto(base() + '/mr/payments/unknown');
  await expect(page.getByText('Payment not found', { exact: true })).toBeVisible();
});

test('MR recovery entry, logout, real password revocation, account replacement and role denial stay real', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(base() + '/mr/orders');
  await expect(page.getByTestId('form-login-mr')).toBeVisible();
  await page.getByTestId('button-forgot-password').click();
  await expect(page).toHaveURL(/forgot-password\?portal=mr/);
  await expect(page.getByLabel('Email or User ID')).toBeVisible();
  // Deliberately do not send recovery mail.
  await login(page, accounts[1]);
  await settings(page);
  await page.getByLabel('Current password', { exact: true }).fill(accounts[1].password);
  await page.getByLabel('New password (12 to 128 characters)').fill('short');
  await page.getByLabel('Confirm new password', { exact: true }).fill('short');
  await page.getByTestId('button-change-password').click();
  await expect(page.getByRole('alert')).toContainText('12 to 128');
  const changed = 'Synthetic-MR-workspace-changed-password';
  await page.getByLabel('New password (12 to 128 characters)').fill(changed);
  await page.getByLabel('Confirm new password', { exact: true }).fill(changed);
  await page.getByTestId('button-change-password').click();
  await expect(page.getByTestId('form-login-mr')).toBeVisible();
  await login(page, { ...accounts[1], password: changed });
  await page.getByTestId('button-profile-menu').click();
  await page.getByTestId('button-mr-signout').click();
  await expect(page.getByTestId('form-login-mr')).toBeVisible();
  await login(page);
  await expect(page.getByTestId('badge-onboarding')).toHaveCount(0);
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ status: 401, headers: { 'X-Session-Reason': 'replaced' }, contentType: 'application/json', body: '{}' }));
  await page.getByTestId('link-nav-doctors').click();
  await expect(page.getByTestId('form-login-mr')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('signed in elsewhere');
  await expect(page.getByTestId('page-mr-home')).toHaveCount(0);
  await page.unroute('**/api/v1/auth/me');
  await authenticateAdmin(page);
  await page.goto(base() + '/mr/home');
  await expect(page.getByTestId('form-login-mr')).toBeVisible();
  await expect(page.getByTestId('page-mr-home')).toHaveCount(0);
});
