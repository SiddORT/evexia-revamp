import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const password = () => process.env.EVEXIA_TEST_ADMIN_PASSWORD;
const adminName = 'crm-admin@allergyevexia.in';

test('primary domain drafts survive conflicts and failed reloads; TXT evidence needs separate activation and revoke', async ({ page }, info) => {
  test.setTimeout(120000);
  await signIn(page);
  await page.goto(base() + '/admin/settings?section=role-urls');
  // Use the Settings link rather than assuming the section query key.
  await page.getByTestId('input-settings-search').fill('hostname');
  await page.getByTestId('link-settings-role-urls').click();
  await page.getByTestId('button-primary-edit').click();
  await page.getByTestId('input-primary-hostname').fill('primary-browser.allergyevexia.com');
  await page.getByTestId('button-primary-save').click();
  await expect(page.getByTestId('text-primary-current')).toContainText('primary-browser.allergyevexia.com');
  await page.reload();
  await expect(page.getByTestId('text-primary-current')).toContainText('primary-browser.allergyevexia.com');
  await page.getByTestId('button-primary-edit').click();
  await page.getByTestId('input-primary-hostname').fill('replacement-browser.allergyevexia.com');
  // Another server mutation invalidates the draft's captured version.
  await page.evaluate(async () => {
    const { roleUrlRequest } = await import('/src/auth/adminSession.js');
    const p = (await roleUrlRequest()).domains.find((d) => d.kind === 'primary');
    await roleUrlRequest('/primary', { hostname: 'concurrent-browser.allergyevexia.com', previous_hostname: p.hostname, version: p.version });
  });
  await page.getByTestId('button-primary-save').click();
  await expect(page.getByTestId('form-primary-domain').getByRole('alert')).toContainText('draft is kept');
  await expect(page.getByTestId('button-primary-save')).toBeDisabled();
  let failReload = true;
  await page.route('**/api/v1/admin/role-urls', (route) => route.request().method() === 'GET' && failReload
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.getByTestId('button-primary-reload').click();
  await expect(page.getByTestId('input-primary-hostname')).toHaveValue('replacement-browser.allergyevexia.com');
  failReload = false;
  await page.getByTestId('button-primary-reload').click();
  await page.getByTestId('button-primary-review').click();
  await page.getByTestId('button-primary-save').click();
  const hostname = 'replacement-browser.allergyevexia.com';
  const row = page.getByTestId(`row-domain-${hostname}`);
  await expect(page.getByTestId('text-primary-current')).toContainText(hostname);
  await row.getByRole('button', { name: `Create challenge ${hostname}`, exact: true }).click();
  await expect(page.getByTestId(`text-challenge-${hostname}`)).toContainText(`_evexia-verification.${hostname}`);
  await expect(row.getByRole('button', { name: `Activate ${hostname}`, exact: true })).toBeDisabled();
  await row.getByRole('button', { name: `Check DNS ${hostname}`, exact: true }).click();
  await expect(row.getByRole('status')).toContainText('Wait 30 seconds');
  await page.waitForTimeout(30100);
  await row.getByRole('button', { name: `Check DNS ${hostname}`, exact: true }).click();
  await expect(row.getByRole('status')).toContainText('Ownership verified');
  await expect(row).toContainText('Verified, inactive');
  await row.getByRole('button', { name: `Activate ${hostname}`, exact: true }).click();
  await expect(row).toContainText('Verified, active');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('primary-domain-verification-mobile.png'), fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: `Revoke ${hostname}`, exact: true }).click();
  await expect(row).toContainText('Revoked, inactive');
  await page.reload();
  await expect(page.getByTestId(`row-domain-${hostname}`)).toContainText('Revoked, inactive');
});

test('cookie-protected exact development preview ingress; other origins omit cookies; redirects fail closed', async ({ browser }) => {
  // The Vite server embeds its exact REPLIT_DEV_DOMAIN only in development.
  const previewHost = process.env.REPLIT_DEV_DOMAIN;
  expect(previewHost).toMatch(/\.replit\.dev$/);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const origins = [previewHost, 'untrusted-preview.replit.dev', 'newuat.allergyevexia.in'];
  for (const host of origins) await context.addCookies([{
    name: 'synthetic_preview_access', value: 'fixture-only', url: `https://${host}`, secure: true, sameSite: 'Lax',
  }]);
  let redirected = false;
  const observed = [];
  await context.route(/^https:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (!origins.includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/v1/portal/resolve') {
      const headers = await route.request().allHeaders();
      const hasCookie = (headers.cookie || '').includes('synthetic_preview_access=fixture-only');
      observed.push({ host: url.hostname, hasCookie, hasBearer: !!headers.authorization });
      // Simulated private ingress, not the real Replit gate. Cookie contents
      // are synthetic; never capture real access cookies in test artifacts.
      if (url.hostname === previewHost && (!hasCookie || redirected)) return route.fulfill({
        status: 307, headers: { location: `https://${previewHost}/__replshield` },
      });
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'cache-control': 'no-store' }, body: '{"role":null}' });
    }
    const response = await route.fetch({ url: base() + url.pathname + url.search, maxRedirects: 0 });
    return route.fulfill({ response });
  });
  const visitor = await context.newPage();
  for (const host of origins) {
    await visitor.goto(`https://${host}/`);
    await expect(visitor.getByText('Select your portal to continue.', { exact: false })).toBeVisible();
    expect(observed.at(-1)).toEqual({ host, hasCookie: host === previewHost, hasBearer: false });
  }
  redirected = true;
  await visitor.goto(`https://${previewHost}/`);
  await expect(visitor.getByRole('button', { name: 'Retry portal lookup' })).toBeVisible();
  await expect(visitor.getByText('Select your portal to continue.', { exact: false })).toHaveCount(0);
  redirected = false;
  await visitor.getByRole('button', { name: 'Retry portal lookup' }).click();
  await expect(visitor.getByText('Select your portal to continue.', { exact: false })).toBeVisible();
  await context.close();
});

async function signIn(page, url = `${base()}/admin/login`, username = adminName, pass = password(), role = 'admin') {
  await page.goto(url);
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId(role === 'mr' ? 'page-mr-home' : 'button-admin-profile')).toBeVisible();
}

// Test-only network proxy for isolated HTTPS origins, without DNS changes or
// external traffic. The browser still owns same-origin cookies and Web Locks.
// Like a trusted ingress, the proxy writes HTTPS scheme and preserves Host.
async function connectTestHosts(context) {
  await context.route(/^https:\/\/[a-z0-9.-]+\.allergyevexia\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: base() + url.pathname + url.search,
      headers: { ...route.request().headers(), host: url.host, 'x-forwarded-proto': 'https' },
    });
    await route.fulfill({ response });
  });
}

async function makeMapping(page, hostname, role) {
  return page.evaluate(async ({ hostname, role }) => {
    const { roleUrlRequest } = await import('/src/auth/adminSession.js');
    const mapping = await roleUrlRequest('', { hostname, role, enabled: true });
    const challenge = await roleUrlRequest('/domain-action', { hostname, version: 0, action: 'challenge' });
    return { mapping, challenge };
  }, { hostname, role });
}

async function activateMappings(page, mappings) {
  // Keep the real server-side cooldown; only DNS lookup is injected.
  await page.waitForTimeout(30100);
  for (const { mapping, challenge } of mappings) await page.evaluate(async ({ mapping, challenge }) => {
    const { roleUrlRequest } = await import('/src/auth/adminSession.js');
    const verified = await roleUrlRequest('/domain-action', { hostname: mapping.hostname, version: challenge.version, action: 'verify' });
    if (verified.status !== 'verified' || verified.active) throw new Error('Fixture verification failed or activated implicitly');
    await roleUrlRequest('/domain-action', { hostname: mapping.hostname, version: verified.version, action: 'activate' });
  }, { mapping, challenge });
}

test('shared settings keyboard/mobile CRUD, draft guard, duplicate and stale recovery', async ({ page, browser }) => {
  await signIn(page);
  await page.goto(base() + '/admin/settings');
  await page.getByTestId('input-settings-search').fill('hostname');
  await page.getByTestId('link-settings-role-urls').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Role URLs Shared setting' })).toBeVisible();
  await page.getByTestId('button-role-url-add').click();
  const tag = Date.now().toString(36);
  const hostname = `settings-${tag}.allergyevexia.com`;
  await page.getByTestId('input-role-url-hostname').fill(`https://${hostname.toUpperCase()}/`);
  await page.getByTestId('input-role-url-role').selectOption('mr');
  await page.getByTestId('button-role-url-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Role URL saved.' })).toBeVisible();
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: `Edit ${hostname}`, exact: true }).click();
  await page.getByTestId('input-role-url-role').selectOption('doctor');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('input-settings-search').fill('general');
  await page.getByTestId('link-settings-basic').click();
  await expect(page.getByTestId('input-role-url-role')).toHaveValue('doctor');
  // Another server actor's write changes this version without overwriting the UI.
  await page.evaluate(async (hostname) => {
    const { roleUrlRequest } = await import('/src/auth/adminSession.js');
    const row = (await roleUrlRequest()).items.find((item) => item.hostname === hostname);
    await roleUrlRequest(`/${row.id}/edit`, { hostname, role: 'admin', enabled: true, version: row.version });
  }, hostname);
  await page.getByTestId('button-role-url-save').click();
  await expect(page.getByRole('alert')).toContainText('Your draft is kept');
  await expect(page.getByTestId('button-role-url-save')).toBeDisabled();
  await page.getByTestId('button-role-url-review').click();
  await expect(page.getByText(/Current server mapping:/)).toContainText('admin');
  await page.getByRole('button', { name: 'I reviewed the current mappings; keep my draft' }).click();
  await page.getByTestId('button-role-url-save').click();
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: `Disable ${hostname}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Enable ${hostname}`, exact: true })).toBeVisible();
  await page.getByTestId('button-role-url-add').click();
  await page.getByTestId('input-role-url-hostname').fill(hostname);
  await page.getByTestId('button-role-url-save').click();
  await expect(page.getByTestId('button-role-url-save')).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('button-role-url-cancel').click();
  await page.getByTestId('button-role-url-add').click();
  await page.getByTestId('input-role-url-hostname').fill(`failed-${hostname}`);
  let saveFailure = true;
  await page.route('**/api/v1/admin/role-urls', (route) => route.request().method() === 'POST' && saveFailure
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    : route.continue());
  await page.getByTestId('button-role-url-save').click();
  await expect(page.getByRole('alert')).toContainText('uncertain');
  await expect(page.getByTestId('input-role-url-hostname')).toHaveValue(`failed-${hostname}`);
  await expect(page.getByTestId('button-role-url-save')).toBeDisabled();
  saveFailure = false;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('button-role-url-cancel').click();
  await page.getByRole('button', { name: `Remove ${hostname}`, exact: true }).click();
  await expect(page.getByTestId('dialog-role-url-remove')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-role-url-remove')).toHaveCount(0);
  await page.getByRole('button', { name: `Remove ${hostname}`, exact: true }).click();
  await page.getByTestId('button-role-url-confirm-remove').click();
  await expect(page.getByText(hostname, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('new visits resolve Admin MR Doctor and unknown hosts; failure retries; incompatible paths stay assigned', async ({ page, browser }) => {
  test.setTimeout(120000);
  await signIn(page);
  const hosts = {};
  const mappings = [];
  for (const role of ['admin', 'mr', 'doctor']) {
    hosts[role] = `${role}-browser.allergyevexia.com`;
    mappings.push(await makeMapping(page, hosts[role], role));
  }
  await activateMappings(page, mappings);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await connectTestHosts(context);
  const visitor = await context.newPage();
  const expectEntry = async (role) => role === 'doctor'
    ? expect(visitor.getByRole('heading', { name: 'IMMUNO PORTAL', exact: true })).toBeVisible()
    : expect(visitor.getByTestId('text-login-title')).toHaveText(role === 'admin' ? 'Admin Portal' : 'Medical Representative Portal');
  for (const role of ['admin', 'mr', 'doctor']) {
    await visitor.goto(`https://${hosts[role]}/`);
    await expectEntry(role);
    await expect(visitor.getByText('Select your portal to continue.', { exact: false })).toHaveCount(0);
    if (role !== 'doctor') await visitor.getByTestId('link-back-portals').click();
    await expectEntry(role);
    await visitor.goto(`https://${hosts[role]}/${role === 'admin' ? 'mr' : 'admin/settings'}`);
    await expect(visitor.getByRole('alert')).toContainText('different portal');
    await visitor.getByRole('link', { name: 'Continue to the assigned portal' }).click();
    await expectEntry(role);
    await visitor.reload();
    await expectEntry(role);
  }
  await visitor.goto(`https://${hosts.doctor}/doctor`);
  await expect(visitor.getByRole('status')).toContainText('This is not real sign-in');
  let credentialRequests = 0;
  visitor.on('request', (request) => { if (request.url().includes('/auth/')) credentialRequests += 1; });
  await visitor.getByRole('textbox', { name: 'Email', exact: true }).fill('synthetic@example.com');
  await visitor.getByLabel('Password', { exact: true }).fill('Synthetic preview only');
  await visitor.getByRole('button', { name: 'Continue to demo', exact: true }).click();
  await expect(visitor.getByText('Only doctor@example.invalid works in this preview.')).toBeVisible();
  expect(credentialRequests).toBe(0);
  await visitor.getByRole('textbox', { name: 'Email', exact: true }).fill(await visitor.locator('.dr-creds dd').nth(0).textContent());
  await visitor.getByLabel('Password', { exact: true }).fill(await visitor.locator('.dr-creds dd').nth(1).textContent());
  await visitor.getByRole('button', { name: 'Continue to demo', exact: true }).click();
  await expect(visitor).toHaveURL(/\/doctor\/home$/);
  expect(credentialRequests).toBe(0);
  const unknown = 'unknown-browser.allergyevexia.com';
  await visitor.goto(`https://${unknown}/`);
  await expect(visitor.getByText('Select your portal to continue.', { exact: false })).toBeVisible();
  let failed = true;
  await visitor.route('**/api/v1/portal/resolve?*', async (route) => failed
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    : route.fallback());
  await visitor.goto(`https://${hosts.mr}/`);
  await expect(visitor.getByRole('button', { name: 'Retry portal lookup' })).toBeVisible();
  await expect(visitor.getByTestId('text-login-title')).toHaveCount(0);
  failed = false;
  await visitor.getByRole('button', { name: 'Retry portal lookup' }).click();
  await expect(visitor.getByTestId('text-login-title')).toHaveText('Medical Representative Portal');
  await context.close();
});

test('same-origin mapped Admin and MR login, deep refresh, renewal and logout retain identity boundaries', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  await signIn(page);
  const tag = Date.now().toString(36);
  const adminHost = 'auth-admin-browser.allergyevexia.com';
  const mrHost = 'auth-mr-browser.allergyevexia.com';
  await activateMappings(page, [await makeMapping(page, adminHost, 'admin'), await makeMapping(page, mrHost, 'mr')]);
  const mrUsername = `host.${tag}`;
  const mrPassword = 'Synthetic role hostname only password';
  await page.evaluate(async ({ mrUsername, mrPassword }) => {
    // Use existing protected provisioning endpoint through a test-only bearer
    // obtained with an ordinary same-origin login, not role-host authorization.
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'crm-admin@allergyevexia.in', password: mrPassword.admin, identity_kind: 'admin' }),
    });
    const token = (await response.json()).access_token;
    const provisioned = await fetch('/api/v1/domain/mrs', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${mrUsername}@example.com`, username: mrUsername, password: mrPassword.mr }),
    });
    if (!provisioned.ok) throw new Error(`MR fixture failed ${provisioned.status}`);
  }, { mrUsername, mrPassword: { admin: password(), mr: mrPassword } });
  // New contexts on distinct hostnames: no shared parent-domain sign-in cookies.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await connectTestHosts(context);
  const visitor = await context.newPage();
  for (const role of ['admin', 'mr']) {
    const host = role === 'admin' ? adminHost : mrHost;
    await signIn(visitor, `https://${host}/`, role === 'admin' ? adminName : mrUsername, role === 'admin' ? password() : mrPassword, role);
    const marker = visitor.getByTestId(role === 'mr' ? 'page-mr-home' : 'button-admin-profile');
    await expect(marker).toBeVisible();
    await visitor.reload();
    await expect(marker).toBeVisible();
    await visitor.evaluate(async (role) => {
      const { verifySession, getSession } = await import('/src/auth/adminSession.js');
      await verifySession(true, role);
      if (getSession().status !== 'authenticated') throw new Error('Renewal failed');
    }, role);
    await expect(marker).toBeVisible();
    const cookies = await context.cookies(`https://${host}/api/v1/auth`);
    expect(cookies.some((c) => c.httpOnly && c.sameSite === 'Strict' && c.domain === host)).toBe(true);
    if (role === 'mr') {
      await visitor.getByTestId('button-profile-menu').click();
      await expect(visitor.getByTestId('text-mr-account')).toContainText(mrUsername);
      await visitor.getByTestId('button-mr-signout').click();
    } else {
      await visitor.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
      await visitor.goto(`https://${host}/admin`);
    }
    await expect(visitor.getByTestId('text-login-title')).toBeVisible();
    await visitor.screenshot({ path: info.outputPath(`${role}-mapped-entry.png`) });
  }
  await visitor.goto(`https://${mrHost}/`);
  await visitor.getByLabel('Email or username').fill(adminName);
  await visitor.getByLabel('Password', { exact: true }).fill(password());
  await visitor.getByTestId('button-submit-login').click();
  await expect(visitor.getByTestId('status-auth-message')).toContainText('Invalid credentials');
  await expect(visitor.getByTestId('page-mr-home')).toHaveCount(0);
  await context.close();
});
