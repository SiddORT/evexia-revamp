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
  await expect(page.getByTestId('section-current-session')).toHaveCount(0);
  await expect(page.getByTestId('form-activity-filters')).toBeHidden();
  await page.getByTestId('button-activity-filters').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('button-activity-filters')).toHaveAttribute('aria-expanded', 'true');
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
  await page.getByTestId('tab-activity-sessions').click();
  await expect(page.getByTestId('panel-activity-sessions').getByRole('columnheader', { name: 'Sr No' })).toBeVisible();
  await page.getByTestId('button-activity-reset').click();
  await page.getByTestId('select-activity-state').selectOption('ACTIVE');
  await page.getByTestId('button-activity-apply').click();
  await expect(page.getByTestId('button-activity-filters')).toHaveAttribute('aria-label', /active/);
  await expect(page.getByTestId('panel-activity-sessions').locator('tbody tr').first().locator('td').first()).toHaveText('1');
  await page.getByTestId('input-activity-session-search').fill('no-such-session-result');
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('No sessions found');
  await page.getByTestId('input-activity-session-search').fill('');
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('Current');
});

for (const [name, scheme, viewport] of [['dark desktop', 'dark', { width: 1440, height: 900 }], ['light mobile', 'light', { width: 375, height: 812 }]]) {
  test(`renders without overflow: ${name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await authenticateAdmin(page);
    await page.goto(`${base()}/admin/activity-logs`);
    await expect(page.getByTestId('text-total-users')).not.toHaveText('…');
    await page.evaluate((appearance) => {
      document.querySelector('[data-admin-appearance]').setAttribute('data-admin-appearance', appearance);
    }, scheme);
    await expect(page.getByTestId('section-activity-summary')).toBeVisible();
    await expect(page.getByTestId('section-current-session')).toHaveCount(0);
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
  await expect(page.getByTestId('link-admin-sign-out')).toHaveText(/Log Out/);
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('section-current-session')).toHaveCount(0);
});

test('sessions pagination numbers across pages and recovers after refreshed results shrink', async ({ page }) => {
  await authenticateAdmin(page);
  let rows;
  let shrink = false;
  await page.route('**/reporting/sessions*', async (route) => {
    if (!rows) {
      const response = await route.fetch();
      const current = (await response.json()).items[0];
      rows = Array.from({ length: 26 }, (_, i) => ({
        ...current, id: `PagedRef${String(i).padStart(2, '0')}`,
        is_current: i === 0, user: { ...current.user, label: 'Paged Example' },
      }));
    }
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const state = url.searchParams.get('state');
    const filtered = (shrink ? rows.slice(0, 1) : rows).filter((row) =>
      (!q || row.id.toLowerCase().includes(q) || row.user.label.toLowerCase().includes(q))
      && (!state || row.state === state));
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 25);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: filtered.slice(offset, offset + limit), offset, limit,
      has_more: filtered.length > offset + limit,
    }) });
  });
  await page.goto(`${base()}/admin/activity-logs`);
  const panel = page.getByTestId('panel-activity-sessions');
  await expect(panel.locator('tbody tr')).toHaveCount(25);
  await expect(panel).toContainText('Page 1 · Rows 1–25');
  await expect(panel.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel).toContainText('Page 2 · Rows 26–26');
  await expect(panel.locator('tbody tr td').first()).toHaveText('26');
  await expect(panel.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.getByTestId('input-activity-session-search').fill('PagedRef25');
  await expect(panel).toContainText('Page 1 · Rows 1–1');
  await expect(panel.locator('tbody tr td').first()).toHaveText('1');
  await page.getByTestId('input-activity-session-search').fill('');
  await expect(panel.locator('tbody tr')).toHaveCount(25);
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel).toContainText('Page 2 · Rows 26–26');
  shrink = true;
  await page.getByTestId('button-activity-refresh').click();
  await expect(panel).toContainText('Page 1 · Rows 1–1');
  await expect(panel).toContainText('PagedRef00');
});

test('late filtered responses cannot replace Reset and a late history cannot survive logout', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await expect(page.getByTestId('section-current-session')).toHaveCount(0);
  await page.getByTestId('button-activity-filters').click();
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

test('page visits and successful local record actions appear without transmitting record data', async ({ page }) => {
  await authenticateAdmin(page);
  const reports = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/reporting/activity')) reports.push(request.postDataJSON());
  });
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.evaluate(async () => {
    const zones = await import('/src/services/zones.js');
    let records = zones.loadZones();
    records = zones.createZone(records, { name: 'PRIVATE-audit-fixture', status: 'active' });
    const id = records.find((r) => r.name === 'PRIVATE-audit-fixture').id;
    records = zones.updateZone(records, id, { name: 'PRIVATE-audit-fixture-edited', status: 'active' });
    zones.exportZoneCSV(records);
    zones.deleteZone(records, id);
  });
  await expect.poll(() => reports.flatMap((r) => r.events).filter((e) => e.resource === 'zone').map((e) => e.action)).toEqual(expect.arrayContaining(['page_view', 'created', 'updated', 'deleted', 'exported']));
  expect(JSON.stringify(reports)).not.toContain('PRIVATE');
  for (const event of reports.flatMap((r) => r.events)) expect(Object.keys(event).sort()).toEqual(['action', 'event_id', 'resource']);
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('tab-activity-events').click();
  await expect(page.getByTestId('panel-activity-events')).toContainText('Record created');
  await expect(page.getByTestId('panel-activity-events')).toContainText('Browser-reported');
  await expect(page.getByTestId('panel-activity-events')).not.toContainText('PRIVATE');
  await expect(page.getByTestId('status-activity-recording')).toHaveCount(0);
  const filters = page.getByTestId('section-activity-filters');
  await page.getByTestId('button-activity-filters').click();
  await page.getByTestId('input-activity-start').fill('2026-01-01');
  await page.getByTestId('button-activity-filters').click();
  await expect(page.getByTestId('form-activity-filters')).toBeHidden();
  await page.getByTestId('button-activity-filters').click();
  await expect(page.getByTestId('input-activity-start')).toHaveValue('2026-01-01');
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
    await expect(tab.getByTestId('section-current-session')).toHaveCount(0);
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
