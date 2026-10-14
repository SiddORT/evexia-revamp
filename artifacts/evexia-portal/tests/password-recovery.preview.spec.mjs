import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
// No traces/videos: recovery fragments and passwords must not become diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const fixture = () => {
  if (!process.env.EVEXIA_RECOVERY_FIXTURE?.startsWith('/tmp/evexia-auth-preview.')) {
    throw Error('Run this spec alone through scripts/run-authenticated-previews.sh');
  }
  return JSON.parse(readFileSync(process.env.EVEXIA_RECOVERY_FIXTURE, 'utf8'));
};
const outbox = () => existsSync(process.env.EVEXIA_RECOVERY_OUTBOX)
  ? readFileSync(process.env.EVEXIA_RECOVERY_OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const nextPassword = 'Synthetic replacement passphrase 387';

async function fillReset(page, password = nextPassword, confirmation = password) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(confirmation);
}
async function resetLink(page, token) {
  // Navigate using a private in-memory value; no link/token in test names or logs.
  await page.goto(`${base()}/reset-password#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
  expect(await page.evaluate(() => location.hash === '')).toBe(true);
}
async function layout(page, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => scrollTo(0, 0));
  const bounds = await page.locator('.recovery-card').evaluate(card => {
    const rect = card.getBoundingClientRect();
    return { x: rect.x, right: rect.right, center: rect.x + rect.width / 2,
      width: rect.width, viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(bounds.overflow).toBe(false);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(Math.abs(bounds.center - width / 2)).toBeLessThan(2);
  expect(bounds.width).toBeLessThanOrEqual(464);
  expect(await page.locator('.recovery-card').evaluate(card => card.getBoundingClientRect().top)).toBeGreaterThanOrEqual(16);
  const treatment = await page.locator('.recovery-page').evaluate(main => ({
    background: getComputedStyle(main).backgroundImage,
    decoration: ['::before', '::after'].map(pseudo => {
      const style = getComputedStyle(main, pseudo);
      return [style.position, style.pointerEvents, style.content];
    }),
    card: getComputedStyle(main.querySelector('.recovery-card')).backgroundColor,
  }));
  expect(treatment.background).toContain('radial-gradient');
  expect(treatment.decoration).toEqual([['absolute', 'none', '""'], ['absolute', 'none', '""']]);
  expect(treatment.card).toBe('rgb(255, 255, 255)');
  const back = page.getByRole('link', { name: 'Back to sign in' });
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();
  expect(await back.evaluate(link => {
    const rect = link.getBoundingClientRect();
    return link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

async function presentation(page) {
  for (const [width, height] of [[1440, 900], [768, 1024], [375, 812], [320, 568], [844, 390]]) {
    await layout(page, width, height);
  }
  // Double actual computed text sizes, including rem and clamped headings.
  await page.locator('.recovery-card').evaluate(card => {
    const elements = [card, ...card.querySelectorAll('*')];
    const sizes = elements.map(element => getComputedStyle(element).fontSize);
    elements.forEach((element, index) => {
      element.dataset.originalStyle = element.getAttribute('style') ?? '';
      element.style.setProperty('font-size', `${parseFloat(sizes[index]) * 2}px`, 'important');
    });
  });
  try {
    expect(await page.locator('#recovery-title').evaluate(title => parseFloat(getComputedStyle(title).fontSize)))
      .toBeGreaterThan(50);
    await layout(page, 320, 480);
  } finally {
    await page.locator('.recovery-card').evaluate(card => {
      for (const element of [card, ...card.querySelectorAll('*')]) {
        element.setAttribute('style', element.dataset.originalStyle);
        delete element.dataset.originalStyle;
      }
    });
    await page.setViewportSize({ width: 375, height: 812 });
  }
}

test('staff recovery: real request, constructed delivery, reset and revoked credentials', async ({ page, playwright }) => {
  const seed = fixture();
  const api = await playwright.request.newContext({ baseURL: base(), extraHTTPHeaders: { Origin: base() } });
  try {
    const oldLogin = await api.post('/api/v1/auth/login', { data: {
      identifier: seed.identifier, password: seed.password, identity_kind: 'admin',
    } });
    expect(oldLogin.status()).toBe(200);
    const oldAccess = (await oldLogin.json()).access_token;
    await page.goto(`${base()}/admin/login`);
    await expect(page.getByTestId('text-super-admin-recovery')).toHaveCount(0);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(`${base()}/admin/login`);
    await expect(page.getByTestId('text-super-admin-recovery')).toHaveText(
      'Super Admin: Contact the tech team to reset your password.');
    await page.getByRole('link', { name: 'Staff password recovery', exact: true }).click();
    await expect(page.getByLabel('Email or User ID')).toBeVisible();
    await presentation(page);
    // Request can be submitted from the keyboard; hold response to prove loading.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/auth/forgot-password', async route => { await held; await route.continue(); });
    await page.getByLabel('Email or User ID').fill(seed.identifier);
    await page.getByLabel('Email or User ID').press('Tab');
    await expect(page.getByRole('button', { name: 'Send recovery link' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    release();
    await expect(page.getByRole('status')).toContainText('Request received');
    await page.unroute('**/api/v1/auth/forgot-password');
    await expect(page.getByText(/Request accepted does not mean delivered/)).toBeVisible();
    await presentation(page);
    await expect.poll(() => outbox().length).toBe(1);
    const delivered = outbox()[0];
    expect(delivered.recipient === 'staff-recovery@example.com').toBe(true);
    const trusted = new URL(delivered.link);
    expect(trusted.origin).toBe('https://portal.example.com');
    expect(trusted.pathname).toBe('/reset-password');
    const token = new URLSearchParams(trusted.hash.slice(1)).get('token');
    await resetLink(page, token);
    await presentation(page);
    await fillReset(page, nextPassword, 'different synthetic password');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('do not match');
    await presentation(page);
    await fillReset(page, seed.password);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('different from your current password');
    await fillReset(page);
    await page.getByLabel('Confirm new password', { exact: true }).press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Password updated');
    await presentation(page);
    const storageContainsToken = await page.evaluate(value =>
      JSON.stringify([localStorage, sessionStorage]).includes(value), token);
    expect(storageContainsToken).toBe(false);
    expect((await api.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${oldAccess}` } })).status()).toBe(401);
    expect((await api.post('/api/v1/auth/refresh')).status()).toBe(401);
    expect((await api.post('/api/v1/auth/login', { data: {
      identifier: seed.identifier, password: seed.password, identity_kind: 'admin',
    } })).status()).toBe(401);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await page.getByLabel('Email or username').fill(seed.identifier);
    await page.getByLabel('Password', { exact: true }).fill(nextPassword);
    await page.getByTestId('button-submit-login').click();
    await expect(page.getByTestId('button-admin-profile')).toBeVisible();
    await resetLink(page, token);
    await fillReset(page);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('invalid, expired or already used');
  } finally { await api.dispose(); }
});

test('Admin recovery submits every identifier and shows the generic response', async ({ page }) => {
  const submitted = [];
  const message = 'If this account is eligible, recovery instructions will be sent.';
  await page.route('**/api/v1/auth/forgot-password', async route => {
    submitted.push(route.request().postDataJSON().identifier);
    await route.fulfill({ status: 202, json: { message } });
  });
  for (const identifier of ['crm-admin@allergyevexia.in', 'synthetic-staff@example.test']) {
    await page.goto(`${base()}/forgot-password?portal=admin`);
    await page.getByLabel('Email or User ID').fill(identifier);
    await page.getByRole('button', { name: 'Send recovery link', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(message);
    expect(submitted.at(-1)).toBe(identifier);
  }
  expect(submitted).toHaveLength(2);
});

test('recovery missing, malformed, expired, temporary error, retry and stale responses', async ({ page }) => {
  const seed = fixture();
  await page.goto(`${base()}/reset-password`);
  await expect(page.getByRole('alert')).toContainText('missing or invalid');
  await presentation(page);
  await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toHaveCount(0);
  await page.goto(`${base()}/reset-password#token=one&token=two`);
  await expect(page.getByRole('alert')).toContainText('missing or invalid');
  expect(await page.evaluate(() => location.hash === '')).toBe(true);
  await resetLink(page, seed.expired);
  await fillReset(page, 'short');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('12 and 128');
  await fillReset(page);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid, expired or already used');
  await page.getByRole('link', { name: 'Request a new recovery link' }).click();
  await page.route('**/api/v1/auth/forgot-password', route => route.fulfill({
    status: 503, json: { error: { message: 'Service unavailable' } },
  }));
  await page.getByLabel('Email or User ID').fill('unknown@example.com');
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await presentation(page);
  await page.unroute('**/api/v1/auth/forgot-password');
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('status')).toContainText('Request received');
  await page.getByRole('button', { name: 'Request another link' }).click();
  await expect(page.getByLabel('Email or User ID')).toBeVisible();
  await page.route('**/api/v1/auth/forgot-password', route => route.abort());
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  await page.unroute('**/api/v1/auth/forgot-password');
  // Late success for an old token cannot replace the newer link's form.
  await resetLink(page, 'synthetic-old');
  let resume;
  let finish;
  const held = new Promise(resolve => { resume = resolve; });
  const completed = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/v1/auth/reset-password', async route => {
    await held;
    await route.fulfill({ status: 200, json: { message: 'Synthetic old response', identity_kind: 'admin' } });
    finish();
  });
  await fillReset(page);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  await page.evaluate(() => { location.hash = 'token=synthetic-new'; });
  await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toBeEnabled();
  resume();
  await completed;
  await page.unroute('**/api/v1/auth/reset-password');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await page.evaluate(() => { location.hash = 'token=one&token=two'; });
  await expect(page.getByRole('alert')).toContainText('missing or invalid');
  expect(await page.evaluate(() => location.hash === '')).toBe(true);
  await page.goto(`${base()}/forgot-password?portal=mr`);
  await expect(page.getByTestId('text-super-admin-recovery')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/mr');
});

test('recovery decoration does not restyle other entry screens after navigation', async ({ page }) => {
  async function appearance(path) {
    await page.goto(`${base()}${path}`);
    await expect(page.locator('main')).toBeVisible();
    return page.locator('main').evaluate(main => {
      const style = getComputedStyle(main);
      const before = getComputedStyle(main, '::before');
      return [style.backgroundColor, style.backgroundImage, style.display,
        before.position, before.borderColor, before.borderRadius];
    });
  }
  for (const path of ['/', '/admin/login', '/mr']) {
    const initial = await appearance(path);
    await page.goto(`${base()}/forgot-password`);
    await expect(page.locator('.recovery-card')).toBeVisible();
    // SPA navigation leaves the recovery stylesheet loaded, unlike page.goto.
    await page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
    await expect(page.locator('.recovery-page')).toHaveCount(0);
    await expect.poll(() => page.locator('main').evaluate(main => {
      const style = getComputedStyle(main);
      const before = getComputedStyle(main, '::before');
      return [style.backgroundColor, style.backgroundImage, style.display,
        before.position, before.borderColor, before.borderRadius];
    })).toEqual(initial);
  }
});
