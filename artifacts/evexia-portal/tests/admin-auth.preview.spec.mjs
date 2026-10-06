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

async function openStaff(page) {
  await login(page);
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
}

async function fillStaff(page, suffix) {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Fictional Staff ${suffix}`);
  await page.getByRole('textbox', { name: 'Email ID', exact: true }).fill(`staff-${suffix}@example.test`);
  const designation = await page.getByTestId('select-staff-designation').locator('option').nth(1).getAttribute('value');
  await page.getByTestId('select-staff-designation').selectOption(designation);
  await page.getByTestId('input-staff-dateOfJoining').fill('2025-01-15');
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`Staff phones, stable IDs and opted-in previews round-trip at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openStaff(page);
    const countries = [['IN', '+91 9876543210', '+919876543210'], ['US', '202 555 0123', '+12025550123'],
      ['GB', '7700 900123', '+447700900123'], ['AE', '50 123 4567', '+971501234567']];
    for (const [index, [country, phone, fullPhone]] of countries.entries()) {
      await page.evaluate(async (i) => {
        const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
        setAdminPreference('theme', i % 2 ? 'modern' : 'classic');
        setAdminPreference('appearance', i > 1 ? 'dark' : 'light');
      }, index);
      await page.getByTestId('button-add-staff').click();
      const id = page.getByRole('textbox', { name: 'User ID', exact: true });
      const candidate = await id.inputValue();
      expect(candidate).toMatch(/^staff-/);
      await expect(id).toHaveAttribute('readonly', '');
      await expect(page.getByLabel('Phone country code')).toHaveValue('IN');
      const invitation = page.getByRole('checkbox', { name: 'Send portal invitation' });
      await expect(invitation).not.toBeChecked();
      await expect(page.getByText('Preview only — no email will be sent', { exact: true })).toBeVisible();
      const optedIn = index % 2 === 0;
      if (optedIn) await invitation.check();
      await page.getByTestId('button-save-staff').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('text-staff-invitation')).toHaveCount(0);
      await expect(page.getByTestId('input-staff-phone')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('input-staff-phone')).toHaveAttribute('aria-describedby', 'staff-error-phone');
      await fillStaff(page, `${viewport.width}-${country}`);
      await page.getByLabel('Phone country code').selectOption(country);
      await page.getByRole('textbox', { name: 'Phone No.', exact: true }).fill(phone);
      await page.getByTestId('input-staff-password').fill('synthetic-transient-staff-password');
      await expect(id).toHaveValue(candidate);
      for (const control of [id, page.getByLabel('Phone country code'), page.getByRole('textbox', { name: 'Phone No.', exact: true }), invitation]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.screenshot({ path: `/tmp/evexia-staff-${viewport.width}-${country}.png`, fullPage: true });
      await page.getByRole('textbox', { name: 'Phone No.', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/evexia-staff-${viewport.width}-${country}-phone.png`, fullPage: true });
      await page.getByTestId('button-save-staff').click();
      if (optedIn) {
        await expect(page.getByTestId('text-staff-invitation')).toContainText(`Hello Fictional Staff ${viewport.width}-${country}`);
        await expect(page.getByTestId('text-staff-invitation')).not.toContainText('synthetic-transient-staff-password');
        await expect(page.getByTestId('status-staff-invitation')).toHaveText('No email was sent. No account was activated.');
        await page.getByTestId('button-close-staff-invitation').click();
      } else await expect(page.getByRole('dialog')).toHaveCount(0);
      const saved = await page.evaluate((userId) => JSON.parse(localStorage.getItem('evexia.admin.staff.v1')).find((row) => row.userId === userId), candidate);
      expect(saved.dialCountry).toBe(country);
      expect(saved.phone).toBe(fullPhone.replace(/^\+(91|1|44|971)/, ''));
      const mobile = viewport.width < 1050;
      const link = page.getByTestId(`link-staff-${mobile ? 'mobile-phone' : 'phone'}-${saved.id}`);
      await expect(link).toHaveText(fullPhone);
      await expect(link).toHaveAttribute('href', `tel:${fullPhone}`);
      await page.getByTestId(`button-edit-staff-${mobile ? 'mobile-' : ''}${saved.id}`).click();
      await expect(page.getByLabel('Phone country code')).toHaveValue(country);
      await expect(id).toHaveValue(candidate);
      await expect(page.getByTestId('checkbox-staff-invitation')).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`${saved.name} Revised`);
      await page.getByTestId('button-save-staff').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByTestId(`button-invite-staff-${mobile ? 'mobile-' : ''}${saved.id}`).click();
      await expect(page.getByTestId('text-staff-invitation')).toContainText(`${saved.name} Revised`);
      await page.getByTestId('button-close-staff-invitation').click();
    }
    const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stores).not.toContain('synthetic-transient-staff-password');
    expect(stores).not.toContain('sendInvitation');
    expect(stores).not.toContain('invitationStatus');
  });
}

test('Staff duplicate validation and failed storage keep the draft, identity and invitation selection', async ({ page, context }) => {
  await openStaff(page);
  await page.getByTestId('button-add-staff').click();
  await fillStaff(page, 'failed-write');
  await page.getByRole('textbox', { name: 'Phone No.', exact: true }).fill('9876543210');
  await page.getByTestId('checkbox-staff-invitation').check();
  const candidate = await page.getByRole('textbox', { name: 'User ID', exact: true }).inputValue();
  await page.getByRole('textbox', { name: 'Email ID', exact: true }).fill('asha@example.test');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByText('Email ID already exists.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('text-staff-invitation')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Email ID', exact: true }).fill('staff-failed-write@example.test');
  const before = await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'));
  await page.evaluate(() => {
    window.syntheticStaffOriginalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'evexia.admin.staff.v1') throw new Error('synthetic quota failure');
      return window.syntheticStaffOriginalSet.call(this, key, value);
    };
  });
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('could not be saved');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('checkbox-staff-invitation')).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'User ID', exact: true })).toHaveValue(candidate);
  await expect(page.getByTestId('text-staff-invitation')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(before);
  await page.evaluate(() => { Storage.prototype.setItem = window.syntheticStaffOriginalSet; });
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('text-staff-invitation')).toContainText('Fictional Staff failed-write');
  await page.getByTestId('button-close-staff-invitation').click();
  await page.getByTestId('button-add-staff').click();
  await fillStaff(page, 'stale-draft');
  const staleId = await page.getByRole('textbox', { name: 'User ID', exact: true }).inputValue();
  const other = await context.newPage();
  await other.goto(`${base()}/admin/staff`);
  await expect(other.getByTestId('button-add-staff')).toBeVisible();
  await other.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('evexia.admin.staff.v1'));
    rows[0].name = 'Synthetic other-tab change';
    localStorage.setItem('evexia.admin.staff.v1', JSON.stringify(rows));
  });
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'User ID', exact: true })).toHaveValue(staleId);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Fictional Staff stale-draft');
  await expect(page.getByTestId('text-staff-invitation')).toHaveCount(0);
});

test('Staff legacy records and old CSV imports default to India and export new country fields without invitations', async ({ page }) => {
  await openStaff(page);
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('evexia.admin.staff.v1'));
    for (const row of rows) delete row.dialCountry;
    rows[0].phone = '+91 9876543210';
    localStorage.setItem('evexia.admin.staff.v1', JSON.stringify(rows));
  });
  await page.reload();
  await page.getByTestId('button-edit-staff-sample-staff-1').click();
  await expect(page.getByLabel('Phone country code')).toHaveValue('IN');
  await expect(page.getByRole('textbox', { name: 'Phone No.', exact: true })).toHaveValue('9876543210');
  await expect(page.getByRole('textbox', { name: 'User ID', exact: true })).toHaveValue('sample.asha');
  await page.getByTestId('button-cancel-staff').click();
  const designation = await page.evaluate(() => JSON.parse(localStorage.getItem('evexia.admin.designations.v1')).find((row) => row.status === 'active').name);
  const csv = `Name,Phone No.,User ID,Email ID,Role,Status,Designation,Date of Joining\nFictional Legacy,+91 9876543213,legacy.fixed,legacy@example.test,Staff,active,${designation},2025-01-15`;
  await page.getByTestId('button-import-staff').click();
  await page.getByTestId('input-staff-import').setInputFiles({ name: 'synthetic-legacy.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('status-staff-import-review')).toContainText('0 with errors');
  await page.getByTestId('checkbox-confirm-staff-import').check();
  await page.getByTestId('button-confirm-staff-import').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('input-search-staff').fill('legacy.fixed');
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  const download = await downloadEvent;
  const { readFile } = await import('node:fs/promises');
  const exported = await readFile(await download.path(), 'utf8');
  expect(exported).toContain('"Dial Country"');
  expect(exported).toContain('"9876543213","IN","legacy.fixed"');
  expect(exported).not.toMatch(/password|invitation|createdAt/i);
});

test('shared Doctor phone control preserves all country options, alternate phone and validation', async ({ page }) => {
  await login(page);
  await page.route('https://api.postalpincode.in/**', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto(`${base()}/admin/masters/doctors`);
  // Navigation may resolve before session restoration and the Doctor load effect.
  await expect(page.getByTestId('checkbox-doctor-sample-doctor-1')).toBeVisible();
  const doctorId = await page.evaluate(() => JSON.parse(localStorage.getItem('evexia.admin.doctors.v1'))[0].id);
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
    const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem('evexia.admin.doctors.v1')).find((row) => row.id === id), doctorId);
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

test('deep links wait for verification; unchanged login controls show safe failures and preserve MR/Doctor mocks', async ({ page }) => {
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
    await expect(page.getByTestId('status-auth-message')).toContainText('No credentials were sent');
    expect(requests).toBe(0);
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