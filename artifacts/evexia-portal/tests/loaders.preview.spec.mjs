import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test('startup fallback uses official logo and ends on mount without a minimum delay', async ({ page }) => {
  const hold = gate();
  await page.route('**/src/main.jsx', async (route) => { await hold.promise; await route.continue(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(base(), { waitUntil: 'commit' });
  try {
    const startup = page.locator('#portal-startup');
    await expect(startup.getByRole('status')).toHaveText('Opening EVEXIA Portal…');
    await expect(startup.locator('img')).toHaveAttribute('src', /images\/evexia-logo\.png$/);
    expect(await startup.locator('.portal-loader__brand').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { hold.release(); }
  await expect(page.locator('#portal-startup')).toHaveCount(0);
  await expect(page.getByTestId('portal-loader')).toHaveCount(0);
});

test('initial access wait does not mount protected content and resolves to instant local Masters', async ({ page }) => {
  await authenticateAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem('evexia.admin.appearance', 'dark');
    localStorage.setItem('evexia.admin.theme', 'modern');
  });
  const hold = gate();
  await page.route('**/api/v1/auth/refresh', async (route) => { await hold.promise; await route.continue(); });
  await page.goto(`${base()}/admin/masters/zones`, { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByTestId('portal-loader').getByRole('status')).toHaveText('Checking Admin access…');
    await expect(page.locator('.portal-loading-page')).toHaveAttribute('data-admin-appearance', 'dark');
    await expect(page.getByTestId('admin-session-content')).toBeHidden();
    await expect(page.getByTestId('admin-session-content')).toBeEmpty();
  } finally { hold.release(); }
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await expect(page.getByTestId('portal-loader')).toHaveCount(0);
  await expect(page.getByTestId('table-skeleton')).toHaveCount(0);
});

test('table loaders retain active headers, toolbar, geometry and distinct result states', async ({ page }) => {
  await authenticateAdmin(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  let hold = gate();
  let result = 'rows';
  await page.route('**/api/v1/admin/reporting/sessions?**', async (route) => {
    const current = hold;
    const mode = result;
    await current.promise;
    if (mode === 'error') return route.fulfill({ status: 503, body: '{}' });
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      items: mode === 'empty' ? [] : Array.from({ length: 25 }, (_, i) => ({
        id: `synthetic-${offset + i}`, user: { label: 'Fictional loader user', role: 'super_admin', account_state: 'active' },
        state: 'ACTIVE', created_at: '2026-01-01T00:00:00Z', persistent: false,
      })), has_more: offset === 0,
    }) });
  });
  await page.goto(`${base()}/admin/activity-logs`);
  const panel = page.getByTestId('panel-activity-sessions');
  const skeleton = panel.getByTestId('table-skeleton');
  await expect(skeleton.locator('tr')).toHaveCount(25);
  await expect(skeleton.locator('tr').first().locator('td')).toHaveCount(9);
  await expect(panel.getByRole('columnheader', { name: 'Sr No' })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Loading sessions…');
  await expect(panel.locator('table')).toHaveAttribute('aria-busy', 'true');
  expect(await skeleton.locator('span').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.getByTestId('button-activity-refresh')).toBeEnabled();
  await expect(page.getByTestId('input-activity-session-search')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const widths = await panel.locator('th').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  hold.release();
  await expect(skeleton).toHaveCount(0);
  expect(await panel.locator('th').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))).toEqual(widths);
  hold = gate();
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(skeleton).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Next page' })).toBeDisabled();
  hold.release();
  await expect(panel.locator('tbody tr').first().locator('td').first()).toHaveText('26');
  hold = gate(); result = 'error';
  await page.getByTestId('button-activity-refresh').click();
  await expect(skeleton).toBeVisible();
  hold.release();
  await expect(panel.getByRole('alert')).toContainText('Could not load');
  await expect(skeleton).toHaveCount(0);
  hold = gate(); result = 'empty';
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(skeleton).toBeVisible();
  hold.release();
  await expect(panel.getByText('No sessions found', { exact: true })).toBeVisible();
  const eventHold = gate();
  await page.route('**/api/v1/admin/reporting/events?**', async (route) => {
    await eventHold.promise;
    await route.fulfill({ contentType: 'application/json', body: '{"items":[],"has_more":false}' });
  });
  await page.getByTestId('tab-activity-events').click();
  const eventPanel = page.getByTestId('panel-activity-events');
  await expect(eventPanel.getByTestId('table-skeleton').locator('tr').first().locator('td')).toHaveCount(9);
  await expect(eventPanel.getByRole('columnheader', { name: 'Event occurred' })).toBeVisible();
  await expect(eventPanel.getByRole('status')).toHaveText('Loading activity events…');
  await page.getByTestId('tab-activity-sessions').click();
  eventHold.release();
  await expect(page.getByTestId('panel-activity-events')).toHaveCount(0);
});
