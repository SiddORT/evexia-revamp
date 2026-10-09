import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => {
  if (!process.env.EVEXIA_PREVIEW_BASE_URL) throw Error('Set EVEXIA_PREVIEW_BASE_URL to the authenticated test preview.');
  return process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
};
const password = () => {
  if (!process.env.EVEXIA_TEST_ADMIN_PASSWORD) throw Error('Set the synthetic test password through the isolated test harness.');
  return process.env.EVEXIA_TEST_ADMIN_PASSWORD;
};

async function login(page, remember = false) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(password());
  if (remember) await page.getByTestId('checkbox-remember').check();
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}

// Server-backed staff lifecycle regressions are in staff-backend.preview.spec.mjs.

test('shared Doctor phone control preserves all country options, alternate phone and validation', async ({ page }) => {
  await login(page);
  const doctorId = await page.evaluate(async () => {
    const label = crypto.randomUUID().slice(0, 8);
    const session = await import('/src/auth/adminSession.js');
    const hq = await session.headquarterRequest('', { body: { name: `Phone HQ ${label}`, status: 'active' } });
    const zone = await session.zoneRequest('', { body: { name: `Phone Zone ${label}`, status: 'active' } });
    const mr = await session.mrRequest('', { body: {
      name: `Phone MR ${label}`, userId: `phone.mr.${label}`, employeeCode: `PHONE-${label}`,
      contactRequirement: 'optional', phone: '', email: '', hq: hq.id, zoneId: zone.id,
      dateOfJoining: '2020-01-01', designation_id: (await session.designationRequest('', { body: { name: `Phone MR designation ${label}`, shortName: 'MR', status: 'active' } })).id, status: 'active',
      addressLine1: 'Address', landmark: 'Landmark', pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
      paymentLimit: '0.00', doctorDaysLimit: 0,
    } });
    const doctor = await session.doctorRequest('', { body: {
      name: `Phone Doctor ${label}`, registrationNumber: `PHONE-${label}`, qualification: 'MBBS',
      mrId: mr.record.id, contactRequirement: 'optional', phone: '', email: '',
      addressLine1: 'Address', landmark: 'Landmark', pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
    } });
    return doctor.id;
  });
  await page.goto(`${base()}/admin/masters/doctors`);
  // Navigation may resolve before session restoration and the shared Doctor load.
  await expect(page.getByTestId(`checkbox-doctor-${doctorId}`)).toBeVisible();
  for (const [country, phone] of [['IN', '9876543210'], ['US', '2025550123'], ['GB', '7700900123'], ['AE', '501234567']]) {
    await page.goto(`${base()}/admin/masters/doctors/${doctorId}`);
    await page.getByLabel('Phone country code').selectOption(country);
    await page.getByTestId('input-doctor-phone').fill('123');
    await page.getByTestId('button-save-doctor').click();
    await expect(page.getByTestId('error-doctor-phone')).toContainText(`${country === 'AE' ? 9 : 10}-digit`);
    await page.getByTestId('input-doctor-phone').fill(phone);
    await page.getByTestId('input-doctor-alternatePhone').fill(phone);
    await page.getByTestId('button-save-doctor').click();
    await expect(page).toHaveURL(/\/admin\/masters\/doctors\?saved=updated/);
    const saved = await page.evaluate(async (id) => (await import('/src/services/serverDoctors.js')).getDoctor(id), doctorId);
    expect(saved.dialCountry).toBe(country);
    expect(saved.phone).toBe(phone);
    expect(saved.alternatePhone).toBe(phone);
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`Admin login has no workspace shortcut and retains controls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${base()}/admin/login`);
    await expect(page.getByTestId('text-login-title')).toHaveText('Admin Portal');
    // Count DOM matches, not just visible matches: a hidden shortcut must not remain.
    await expect(page.getByText(/Open Admin workspace/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open Admin workspace/i, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);

    const email = page.getByLabel('Email or username');
    const passwordInput = page.getByLabel('Password', { exact: true });
    const remember = page.getByRole('checkbox', { name: 'Remember me' });
    const forgot = page.getByRole('button', { name: 'Forgot password?' });
    const submit = page.getByRole('button', { name: 'Log in', exact: true });
    const back = page.getByRole('link', { name: 'Choose a different portal' });
    const controls = [email, passwordInput, remember, forgot, submit, back];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    const submitBox = await submit.boundingBox();
    const backBox = await back.boundingBox();
    expect(backBox.y - (submitBox.y + submitBox.height)).toBeGreaterThanOrEqual(20);
    const rememberBox = await page.locator('label.remember').boundingBox();
    const forgotBox = await forgot.boundingBox();
    if (viewport.width <= 460) {
      expect(forgotBox.y - (rememberBox.y + rememberBox.height)).toBeGreaterThanOrEqual(8);
    } else {
      expect(rememberBox.x + rememberBox.width).toBeLessThanOrEqual(forgotBox.x);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    // Removing the shortcut must preserve the remaining keyboard navigation.
    await page.getByTestId('link-form-home').focus();
    for (const control of [email, passwordInput, page.getByTestId('button-toggle-password'), remember, forgot, submit, back]) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
    }
    await expect(back).toHaveAttribute('href', '/');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${base()}/`);
    await login(page);
    await expect(page).toHaveURL(`${base()}/admin`);
  });
}

test('deep links wait for verification; login controls show safe failures, real MR login and Doctor mock', async ({ page }) => {
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('button-admin-profile')).toHaveCount(0);
  await expect(page.getByTestId('text-login-title')).toHaveText('Admin Portal');
  await page.getByLabel('Email or username').fill('unknown-synthetic@example.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-synthetic-password');
  await page.getByTestId('button-toggle-password').click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByTestId('button-toggle-password').click();
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('status-auth-message')).toContainText('Invalid credentials');
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{}' }));
  await page.getByLabel('Password', { exact: true }).fill('incorrect-synthetic-password');
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('status-auth-message')).toContainText('Too many attempts');
  await page.unroute('**/api/v1/auth/login');
  await page.route('**/api/v1/auth/login', (route) => route.abort());
  await page.getByLabel('Password', { exact: true }).fill('incorrect-synthetic-password');
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('status-auth-message')).toContainText('Unable to reach');
  await page.unroute('**/api/v1/auth/login');
  await page.getByTestId('button-forgot-password').click();
  await expect(page.getByTestId('status-auth-message')).toContainText('contact your EVEXIA administrator');
  for (const path of ['/mr', '/doctor']) {
    let requests = 0;
    const observe = (request) => { if (request.url().includes('/api/v1/auth/login')) requests++; };
    page.on('request', observe);
    await page.goto(`${base()}${path}`);
    await page.getByLabel('Email or username').fill('fictional@example.test');
    await page.getByLabel('Password', { exact: true }).fill('mock-only');
    await page.getByTestId('button-submit-login').click();
    await expect(page.getByTestId('status-auth-message')).toContainText(path === '/doctor' ? 'No credentials were sent' : 'Invalid credentials');
    expect(requests).toBe(path === '/doctor' ? 0 : 1);
    page.off('request', observe);
  }
});

test('real UI login, reload, session cookie and logout retain local records without persisting credentials', async ({ page, context }) => {
  await login(page);
  const cookie = (await context.cookies()).find((value) => value.name.includes('evexia_refresh'));
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Strict');
  expect(cookie.expires).toBe(-1);
  await page.evaluate(() => localStorage.setItem('synthetic-local-record', 'fictional-only'));
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.getByTestId('button-admin-profile').click();
  await expect(page.getByText('Authenticated Super Admin')).toBeVisible();
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stores).not.toContain(password());
  expect(stores).not.toContain('access_token');
  expect(stores).not.toContain('refresh_token');
  expect(stores).not.toContain('crm-admin@allergyevexia.in');
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect.poll(async () => (await context.cookies()).some((value) => value.name.includes('evexia_refresh'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('synthetic-local-record'))).toBe('fictional-only');
  await page.goto(`${base()}/admin/settings`);
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('UI logout revokes its actual session, rejects replay and remains safe on repeated requests', async ({ page, context }) => {
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
  await login(page);
  const access = (await (await loginResponse).json()).access_token;
  const refresh = (await context.cookies()).find((cookie) => cookie.name.includes('evexia_refresh'));
  expect(Boolean(refresh)).toBe(true);
  await page.getByTestId('button-admin-profile').click();
  const logoutResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout'));
  await page.getByTestId('link-admin-sign-out').click();
  expect((await logoutResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await context.cookies()).some((cookie) => cookie.name.includes('evexia_refresh'))).toBe(false);

  // Synthetic fixture credentials are kept in this test's memory only, never
  // emitted in assertions, attachments, storage or logs.
  const replay = await context.request.post(`${base()}/api/v1/auth/refresh`, {
    headers: { Origin: base(), Cookie: `${refresh.name}=${refresh.value}` },
    data: {},
  });
  expect(replay.status()).toBe(401);
  expect(Object.hasOwn(await replay.json(), 'access_token')).toBe(false);
  const denied = await context.request.get(`${base()}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  expect(denied.status()).toBe(401);
  const repeated = await context.request.post(`${base()}/api/v1/auth/logout`, {
    headers: { Origin: base() }, data: {},
  });
  expect(repeated.status()).toBe(204);
  expect(await repeated.text()).toBe('');
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('button-admin-profile')).toHaveCount(0);
});

test('Remember me persistence and two-tab refresh are serialized without token sharing; logout clears both tabs', async ({ page, context }) => {
  await login(page, true);
  expect((await context.cookies()).find((value) => value.name.includes('evexia_refresh')).expires).toBeGreaterThan(Date.now() / 1000);
  const other = await context.newPage();
  await Promise.all([page.reload(), other.goto(`${base()}/admin/settings`)]);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await expect(other.getByTestId('button-admin-profile')).toBeVisible();
  await Promise.all([page, other].map((tab) => tab.evaluate(async () => {
    const session = await import('/src/auth/adminSession.js');
    await Promise.all([session.verifySession(true), session.verifySession(true)]);
  })));
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await expect(other.getByTestId('button-admin-profile')).toBeVisible();
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(other).toHaveURL(/\/admin\/login/);
  await expect(other.getByTestId('button-admin-profile')).toHaveCount(0);
});

test('expired refresh redirects without loops and unconfirmed logout offers retry', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('status-auth-message')).toHaveCount(0);
  await page.unroute('**/api/v1/auth/refresh');
  await login(page);
  await page.route('**/api/v1/auth/logout', (route) => route.abort());
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page.getByTestId('status-auth-message')).toContainText('revocation could not be confirmed');
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Retry Sign Out' }).click();
  await expect(page.getByTestId('status-auth-message')).toHaveCount(0);
});

test('another browser login ends the earlier session with a safe notice, not a silent renewal', async ({ page, browser }) => {
  await login(page);
  await page.goto(`${base()}/admin/masters/patients/new`);
  await page.getByTestId('input-patient-name').fill('Fictional replaced-session draft');
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await login(other);
    let refreshes = 0;
    page.on('request', (request) => { if (request.url().endsWith('/auth/refresh')) refreshes++; });
    await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
    await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
    await expect(page.getByTestId('status-auth-message')).toHaveText(
      'Your Admin session ended because this account was signed in elsewhere. Please log in again.',
    );
    await expect(page.getByTestId('input-patient-name')).toHaveCount(0);
    await expect(page.getByTestId('button-admin-profile')).toHaveCount(0);
    expect(refreshes).toBe(0);
    await expect(other.getByTestId('button-admin-profile')).toBeVisible();
    // The explanation is memory-only and cannot be manufactured by a URL.
    await page.reload();
    await expect(page.getByTestId('status-auth-message')).toHaveCount(0);
    await page.goto(`${base()}/admin/login?reason=replaced`);
    await expect(page.getByTestId('status-auth-message')).toHaveCount(0);
    await login(page);
    await expect(page.getByTestId('status-auth-message')).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('external return path never navigates away and forged frontend roles cannot authorize', async ({ page }) => {
  await page.goto(`${base()}/admin/login?returnTo=${encodeURIComponent('//external.example.test')}`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(password());
  await page.getByTestId('button-submit-login').click();
  await expect(page).toHaveURL(`${base()}/admin`);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ id: 'synthetic', email: 'ordinary@example.test', system_role: 'super_admin', permissions: [] }),
  }));
  await page.goto(`${base()}/admin/settings`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('button-admin-profile')).toHaveCount(0);
});

test('unsaved Patient draft stays mounted but hidden through renewal and transient-error retry', async ({ page }) => {
  await login(page);
  await page.goto(`${base()}/admin/masters/patients/new`);
  const name = page.getByTestId('input-patient-name');
  await name.fill('Fictional unsaved renewal draft');
  await page.evaluate(() => { window.syntheticDraftNode = document.querySelector('input[name="name"]'); });
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  await page.route('**/api/v1/auth/refresh', async (route) => { await gate; await route.continue(); });
  const renewing = page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByTestId('admin-session-content')).toBeHidden();
  await expect(page.getByTestId('admin-session-content')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('portal-loader').getByRole('status')).toHaveText('Renewing Admin access…');
  await expect(name).toHaveValue('Fictional unsaved renewal draft');
  resume();
  await renewing;
  await expect(name).toBeVisible();
  expect(await page.evaluate(() => window.syntheticDraftNode === document.querySelector('input[name="name"]'))).toBe(true);
  await page.unroute('**/api/v1/auth/refresh');
  await page.route('**/api/v1/auth/refresh', (route) => route.abort());
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  await expect(page.getByTestId('portal-loader')).toHaveCount(0);
  await expect(name).toBeHidden();
  await expect(name).toHaveValue('Fictional unsaved renewal draft');
  await page.unroute('**/api/v1/auth/refresh');
  await page.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('Fictional unsaved renewal draft');
  expect(await page.evaluate(() => window.syntheticDraftNode === document.querySelector('input[name="name"]'))).toBe(true);
});