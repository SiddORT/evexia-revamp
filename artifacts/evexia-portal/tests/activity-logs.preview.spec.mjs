import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');

test('profile menu navigates; deep link, filters, reset, refresh', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin`);
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-activity-logs').click();
  await expect(page).toHaveURL(/\/admin\/activity-logs$/);
  await page.goto(`${base()}/admin/activity-logs`);
  await expect(page.getByRole('heading', { name: 'Sessions & Activity Logs' })).toBeVisible();
  await expect(page.getByTestId('text-total-users')).not.toHaveText('…');
  await expect(page.getByTestId('section-current-session')).toContainText('ACTIVE');
  await expect(page.getByText(/not live presence/)).toBeVisible();

  await page.getByTestId('input-activity-start').fill('2030-02-02');
  await page.getByTestId('input-activity-end').fill('2030-02-01');
  await page.getByTestId('button-activity-apply').click();
  await expect(page.getByTestId('status-activity-filter-error')).toBeVisible();

  const requests = [];
  page.on('request', (r) => { if (r.url().includes('/reporting/sessions')) requests.push(new URL(r.url())); });
  await page.getByTestId('input-activity-end').fill('2030-02-02');
  await page.getByTestId('button-activity-apply').click();
  await expect.poll(() => requests.some((u) => u.searchParams.get('end') === '2030-02-03T00:00:00Z')).toBe(true);
  await page.getByTestId('button-activity-reset').click();
  await expect(page.getByTestId('input-activity-start')).toHaveValue('');
  await page.getByTestId('tab-activity-events').click();
  await expect(page.getByTestId('panel-activity-events')).toBeVisible();
  await page.getByTestId('button-activity-refresh').click();
  await page.getByTestId('button-activity-user').click();
  await expect(page.getByTestId('panel-activity-users')).toBeVisible();
  await page.getByTestId('option-activity-user').first().click();
  await page.getByTestId('button-activity-apply').click();
  await expect(page.getByTestId('panel-activity-events').getByText('Unknown/System')).toHaveCount(0);
  await expect(page.getByTestId('text-total-users')).not.toHaveText('…');
});

for (const [name, scheme, viewport] of [['dark desktop', 'dark', { width: 1440, height: 900 }], ['light mobile', 'light', { width: 375, height: 812 }]]) {
  test(`renders without overflow: ${name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await authenticateAdmin(page);
    await page.goto(`${base()}/admin/activity-logs`);
    await expect(page.getByTestId('section-current-session')).toContainText('ACTIVE');
    await page.evaluate((appearance) => {
      document.querySelector('[data-admin-appearance]').setAttribute('data-admin-appearance', appearance);
    }, scheme);
    await expect(page.getByTestId('section-activity-summary')).toBeVisible();
    await expect(page.getByTestId('section-current-session')).toContainText('ACTIVE');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`activity-${scheme}.png`), fullPage: true });
  });
}

test('error shows retry and logout clears private data', async ({ page }) => {
  await authenticateAdmin(page);
  await page.route('**/reporting/events*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('tab-activity-events').click();
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('section-current-session')).toHaveCount(0);
});

test('late filtered responses cannot replace Reset and a late history cannot survive logout', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await expect(page.getByTestId('section-current-session')).toContainText('ACTIVE');
  const held = [];
  let intercepted;
  const seen = new Promise((resolve) => { intercepted = resolve; });
  await page.route('**/reporting/sessions*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('start')) return route.continue();
    const response = await route.fetch();
    held.push([route, response]);
    intercepted();
  });
  await page.getByTestId('input-activity-start').fill('2030-02-02');
  await page.getByTestId('button-activity-apply').click();
  await seen;
  await page.getByTestId('button-activity-reset').click();
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('Current');
  for (const [route, response] of held) await route.fulfill({ response }).catch(() => {});
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('Current');
  await page.unroute('**/reporting/sessions*');
  let delayed;
  const started = new Promise((resolve) => { delayed = resolve; });
  let pending;
  await page.route('**/reporting/events*', async (route) => {
    pending = [route, await route.fetch()];
    delayed();
  });
  await page.getByTestId('tab-activity-events').click();
  await started;
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await pending[0].fulfill({ response: pending[1] }).catch(() => {});
  await expect(page.getByTestId('section-current-session')).toHaveCount(0);
  await expect(page.getByTestId('panel-activity-events')).toHaveCount(0);
});

test('two tabs renew reports through real cookie locking and persist no private history', async ({ page, context }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  const other = await context.newPage();
  await other.goto(`${base()}/admin/activity-logs`);
  await Promise.all([page, other].map((tab) => tab.evaluate(async () => {
    await (await import('/src/auth/adminSession.js')).verifySession(true);
  })));
  for (const tab of [page, other]) {
    await expect(tab.getByTestId('section-current-session')).toContainText('ACTIVE');
    await tab.getByTestId('tab-activity-events').click();
    await expect(tab.getByTestId('panel-activity-events')).toContainText('refresh');
    const stored = await tab.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    expect(stored).not.toMatch(/access_token|session_id|refresh_success|crm-admin|password_hash/);
  }
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(other).toHaveURL(/\/admin\/login/);
  await expect(other.getByTestId('panel-activity-events')).toHaveCount(0);
});
