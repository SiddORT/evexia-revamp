import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { readFile } from 'node:fs/promises';

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
    const toolbar = page.getByTestId('toolbar-activity');
    await expect(toolbar.getByRole('tablist')).toBeVisible();
    await expect(toolbar.getByRole('searchbox', { name: 'Search sessions' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Export sessions CSV' })).toBeVisible();
    expect(await toolbar.getByRole('tablist').getByRole('searchbox').count()).toBe(0);
    const tabsBox = await toolbar.getByRole('tablist').boundingBox();
    const searchBox = await toolbar.getByRole('searchbox').boundingBox();
    const exportBox = await toolbar.getByRole('button', { name: 'Export sessions CSV' }).boundingBox();
    if (viewport.width > 640) {
      expect(searchBox.x).toBeGreaterThan(tabsBox.x + tabsBox.width);
      expect(Math.abs(searchBox.y - tabsBox.y)).toBeLessThan(5);
      expect(Math.abs(exportBox.y - tabsBox.y)).toBeLessThan(5);
    }
    for (const box of [tabsBox, searchBox, exportBox]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
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

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 375, height: 812 }],
]) {
  test(`session-ending explanations survive filters and pagination: ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await authenticateAdmin(page);
    // Deliberately spell out the UI contract rather than importing its mapping.
    // Projection/history attribution belongs to the backend reporting tests.
    const cases = [
      { state: 'REVOKED', revocation_reason: 'new_login', expected: 'Replaced by a new login' },
      { state: 'REVOKED', revocation_reason: 'logout', expected: 'Logged out' },
      { state: 'REVOKED', revocation_reason: 'password_change', expected: 'Password changed' },
      { state: 'REVOKED', revocation_reason: 'identity_change', expected: 'Account access changed' },
      { state: 'REVOKED', revocation_reason: 'identity_invalid', expected: 'Account security changed' },
      { state: 'REVOKED', revocation_reason: 'replay', expected: 'Revoked for security' },
      { state: 'REVOKED', revocation_reason: null, expected: 'Reason unavailable' },
      { state: 'REVOKED', expected: 'Reason unavailable' }, // Older response without the field.
      { state: 'REVOKED', revocation_reason: '', expected: 'Reason unavailable' },
      { state: 'REVOKED', revocation_reason: 'unknown_internal_cause', expected: 'Reason unavailable' },
      { state: 'ACTIVE', revocation_reason: 'new_login', expected: '—' },
      { state: 'EXPIRED', revocation_reason: 'logout', expected: 'Session time limit passed' },
      { state: 'INVALIDATED', revocation_reason: 'replay', expected: 'Account access or security changed' },
    ];
    // Each 25-row page contains every case, including a different session with
    // the same cause. This catches explanations disappearing on later pages.
    const rows = Array.from({ length: 50 }, (_, i) => {
      const { expected, ...fields } = cases[(i % 25) % cases.length];
      return {
        id: `EndingRef${String(i).padStart(2, '0')}`,
        user: { label: 'Session explanation example', role: 'super_admin', account_state: 'enabled' },
        created_at: '2030-02-02T00:00:00Z', last_refreshed_at: null,
        expires_at: '2030-02-03T00:00:00Z',
        revoked_at: fields.state === 'REVOKED' ? '2030-02-02T01:00:00Z' : null,
        persistent: false, is_current: false, ...fields, expected,
      };
    });
    await page.route(/\/reporting\/sessions(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const state = url.searchParams.get('state');
      const filtered = rows.filter((row) =>
        (!q || row.id.toLowerCase().includes(q)) && (!state || row.state === state));
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 25);
      await route.fulfill({ json: {
        items: filtered.slice(offset, offset + limit).map(({ expected, ...row }) => row),
        offset, limit, has_more: offset + limit < filtered.length,
      } });
    });
    await page.goto(`${base()}/admin/activity-logs`);
    const panel = page.getByTestId('panel-activity-sessions');
    const header = panel.getByRole('columnheader', { name: 'Why session ended', exact: true });
    const assertExplanations = async (expectedRows, pageNumber, offset) => {
      await expect(panel).toContainText(`Page ${pageNumber} · Rows ${offset + 1}–${offset + expectedRows.length}`);
      await expect(panel.locator('tbody tr')).toHaveCount(expectedRows.length);
      await header.scrollIntoViewIfNeeded();
      await expect(header).toBeVisible();
      for (const row of expectedRows) {
        const rendered = panel.locator('tbody tr').filter({
          has: page.getByRole('cell', { name: row.id, exact: true }),
        });
        // Check the actual column as well as the test hook, not unrelated text
        // elsewhere in the row or explanatory text above the table.
        await expect(rendered.getByRole('cell').nth(4)).toHaveText(row.expected);
        await expect(rendered.getByTestId('text-session-ending-reason')).toHaveText(row.expected);
      }
      for (const raw of ['new_login', 'logout', 'password_change', 'identity_change',
        'identity_invalid', 'replay', 'unknown_internal_cause']) {
        await expect(panel).not.toContainText(raw);
      }
    };
    await assertExplanations(rows.slice(0, 25), 1, 0);
    await panel.getByRole('button', { name: 'Next page' }).click();
    await assertExplanations(rows.slice(25), 2, 25);
    await expect(panel.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Previous page' }).click();
    await assertExplanations(rows.slice(0, 25), 1, 0);

    await page.getByTestId('button-activity-filters').click();
    await page.getByTestId('select-activity-state').selectOption('REVOKED');
    await page.getByTestId('button-activity-apply').click();
    const revoked = rows.filter((row) => row.state === 'REVOKED');
    await assertExplanations(revoked.slice(0, 25), 1, 0);
    await panel.getByRole('button', { name: 'Next page' }).click();
    await assertExplanations(revoked.slice(25), 2, 25);

    const search = page.getByTestId('input-activity-session-search');
    await search.fill('EndingRef34'); // Unknown cause on the original second page.
    await assertExplanations([rows[34]], 1, 0);
    await search.fill('EndingRef25'); // Replacement explanation on that same page.
    await assertExplanations([rows[25]], 1, 0);
    await search.fill('');
    await assertExplanations(revoked.slice(0, 25), 1, 0);
    await page.getByTestId('button-activity-reset').click();
    await assertExplanations(rows.slice(0, 25), 1, 0);
    await page.getByTestId('button-activity-refresh').click();
    await assertExplanations(rows.slice(0, 25), 1, 0);
  });
}

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

test('both CSV tabs export all applied user/UTC filters, not draft filters or the current page', async ({ page }) => {
  const user = await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await expect(page.getByTestId('text-total-users')).not.toHaveText('…');
  await page.getByTestId('button-activity-filters').click();
  await page.getByTestId('button-activity-user').click();
  await page.getByTestId('option-activity-user').filter({ hasText: user.username || user.email }).first().click();
  await page.getByTestId('input-activity-start').fill('2030-02-02');
  await page.getByTestId('input-activity-end').fill('2030-02-02');
  await page.getByTestId('button-activity-apply').click();
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('No sessions found');
  await page.getByTestId('input-activity-start').fill('2040-01-01'); // unapplied draft
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('/export?')) requests.push(new URL(r.url())); });
  for (const resource of ['sessions', 'events']) {
    await page.getByTestId(`tab-activity-${resource}`).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(`button-activity-export-${resource}`).click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain('"Provenance"');
    expect(csv.trim().split('\r\n')).toHaveLength(1); // empty matching snapshot still has headers
    expect(csv).not.toMatch(/session_id|actor_id|resource_id|access_token/);
    await expect(page.getByTestId('status-activity-export')).toContainText('0 rows');
    const query = requests.at(-1).searchParams;
    expect(query.get('user_id')).toBe(user.id);
    expect(query.get('start')).toBe('2030-02-02T00:00:00Z');
    expect(query.get('end')).toBe('2030-02-03T00:00:00Z');
    expect(query.has('offset')).toBe(false);
  }
  await page.getByTestId('button-activity-reset').click();
  await page.getByTestId('tab-activity-sessions').click();
  const report = await page.evaluate(async () => {
    const { reportingRequest } = await import('/src/auth/adminSession.js');
    return reportingRequest('sessions/export');
  });
  const next = page.waitForEvent('download');
  await page.getByTestId('button-activity-export-sessions').click();
  const csv = await readFile(await (await next).path(), 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(report.row_count + 1);
  expect(csv).toContain('Server-recorded');
});

test('sessions CSV uses the same applied state and debounced search as the table', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('button-activity-filters').click();
  await page.getByTestId('select-activity-state').selectOption('REVOKED');
  await page.getByTestId('button-activity-apply').click();
  await page.getByTestId('input-activity-session-search').fill('no-such-session-export');
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('No sessions found');
  const request = page.waitForRequest((r) => r.url().includes('/sessions/export?'));
  const next = page.waitForEvent('download');
  await page.getByTestId('button-activity-export-sessions').click();
  const query = new URL((await request).url()).searchParams;
  expect(query.get('state')).toBe('REVOKED');
  expect(query.get('q')).toBe('no-such-session-export');
  const csv = await readFile(await (await next).path(), 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(1);
});

test('CSV preserves provenance and escapes spreadsheet formulas and embedded quotes', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('tab-activity-events').click();
  await page.route('**/reporting/events/export*', (route) => route.fulfill({
    json: {
      columns: ['Occurred (UTC)', 'User', 'Role', 'Account state', 'Action', 'Outcome', 'Reason', 'Resource type', 'Provenance'],
      rows: [
        ['2030-02-02T00:00:00Z', '  =formula,"quoted"\r\nsecond line', 'super_admin', 'enabled', 'browser_created', 'reported', 'browser_reported', 'patient', 'Browser-reported'],
        ['2030-02-02T00:00:00Z', '@formula', 'super_admin', 'enabled', 'login_success', 'success', '', '', 'Server-recorded'],
      ], row_count: 2, limit: 5000,
    },
  }));
  const next = page.waitForEvent('download');
  await page.getByTestId('button-activity-export-events').click();
  const csv = await readFile(await (await next).path(), 'utf8');
  expect(csv).toContain('"\'  =formula,""quoted""\r\nsecond line"');
  expect(csv).toContain('"\'@formula"');
  expect(csv).toContain('Browser-reported');
  expect(csv).toContain('Server-recorded');
});

test('overflow, network, incomplete response and browser download failures never export stale table data', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('Current');
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  for (const [failure, message] of [
    ['overflow', /5,000/], ['network', /connection|retry/i],
    ['incomplete', /incomplete or invalid/], ['browser', /browser could not create/],
  ]) {
    await page.route('**/reporting/sessions/export*', (route) => {
      if (failure === 'overflow') return route.fulfill({ status: 409, json: {} });
      if (failure === 'network') return route.abort();
      if (failure === 'incomplete') return route.fulfill({ json: { columns: [], rows: [] } });
      return route.continue();
    });
    if (failure === 'browser') await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('synthetic unavailable'); }; });
    await page.getByTestId('button-activity-export-sessions').click();
    await expect(page.getByTestId('status-activity-export')).toContainText(message);
    expect(downloads).toHaveLength(0);
    await page.unroute('**/reporting/sessions/export*');
  }
});

for (const cancel of ['logout', 'filters', 'tab', 'authorization', 'search']) {
  test(`pending CSV is discarded on ${cancel}`, async ({ page }) => {
    await authenticateAdmin(page);
    await page.goto(`${base()}/admin/activity-logs`);
    await expect(page.getByTestId('text-total-users')).not.toHaveText('…');
    let pending, intercepted;
    const started = new Promise((resolve) => { intercepted = resolve; });
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.route('**/reporting/sessions/export*', async (route) => {
      pending = [route, await route.fetch()];
      intercepted();
    });
    await page.getByTestId('button-activity-export-sessions').click();
    await started;
    if (cancel === 'logout') {
      await page.getByTestId('button-admin-profile').click();
      await page.getByTestId('link-admin-sign-out').click();
      await expect(page).toHaveURL(/\/admin\/login/);
    } else if (cancel === 'filters') {
      await page.getByTestId('button-activity-filters').click();
      await page.getByTestId('button-activity-reset').click(); // even unchanged filters cancel
      await expect(page.getByTestId('status-activity-export')).toContainText('cancelled');
      await expect(page.getByTestId('button-activity-export-sessions')).toBeEnabled();
    } else if (cancel === 'tab') {
      await page.getByTestId('tab-activity-events').click();
      await expect(page.getByTestId('button-activity-export-events')).toBeEnabled();
    } else if (cancel === 'search') {
      await page.getByTestId('input-activity-session-search').fill('cancel-export');
      await expect(page.getByTestId('status-activity-export')).toContainText('cancelled');
    } else {
      // The final server authorization check must fail closed even after a
      // successful snapshot response, without releasing that snapshot.
      await page.route('**/reporting/summary', (route) => route.fulfill({ status: 403, json: {} }));
    }
    await pending[0].fulfill({ response: pending[1] }).catch(() => {});
    if (cancel === 'authorization') await expect(page).toHaveURL(/\/admin\/login/);
    else await page.waitForTimeout(200);
    expect(downloads).toHaveLength(0);
  });
}

test('activity whole-result search, serials, independent tabs, keyboard controls and searched CSV', async ({ page }) => {
  await authenticateAdmin(page);
  const rows = Array.from({ length: 28 }, (_, i) => ({
    id: `event-${i}`, created_at: '2030-02-02T00:00:00Z',
    user: { label: 'Paged actor', role: 'super_admin', account_state: 'enabled' },
    action: 'browser_created', outcome: 'reported', reason: 'browser_reported',
    resource_type: 'zone', resource_id: null, session_id: `EventRef${i}`, request_id: null,
  }));
  const calls = [];
  await page.route(/\/reporting\/events(?:\/export)?(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const filtered = rows.filter((row) => !q || row.session_id.toLowerCase().includes(q) ||
      'record created zone master browser-reported paged actor'.includes(q));
    if (url.pathname.endsWith('/export')) {
      return route.fulfill({ json: {
        columns: ['Occurred (UTC)', 'User', 'Role', 'Account state', 'Action', 'Outcome', 'Reason', 'Resource type', 'Provenance'],
        rows: filtered.map((row) => [row.created_at, row.user.label, 'super_admin', 'enabled',
          row.action, row.outcome, row.reason, row.resource_type, 'Browser-reported']),
        row_count: filtered.length, limit: 5000,
      } });
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 25);
    return route.fulfill({ json: {
      items: filtered.slice(offset, offset + limit), offset, limit, has_more: offset + limit < filtered.length,
    } });
  });
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('input-activity-session-search').fill('independent-session-query');
  await expect(page.getByTestId('panel-activity-sessions')).toContainText('No sessions found');
  await page.getByTestId('tab-activity-sessions').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-activity-events')).toBeFocused();
  const panel = page.getByTestId('panel-activity-events');
  const search = page.getByRole('searchbox', { name: 'Search activity events' });
  await expect(panel).toContainText('Page 1 · Rows 1–25');
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel).toContainText('Page 2 · Rows 26–28');
  await expect(panel.locator('tbody tr td').first()).toHaveText('26');
  await expect(panel.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await search.fill('EventRef27');
  await expect(page.getByTestId('button-activity-export-events')).toBeDisabled();
  await expect(panel).toContainText('Page 1 · Rows 1–1');
  await expect(panel.locator('tbody tr td').first()).toHaveText('1');
  await expect(panel).toContainText('EventRef27');
  await page.getByTestId('tab-activity-sessions').click();
  await expect(page.getByTestId('input-activity-session-search')).toHaveValue('independent-session-query');
  await page.getByTestId('tab-activity-events').click();
  await expect(search).toHaveValue('EventRef27');
  let download = page.waitForEvent('download');
  await page.getByTestId('button-activity-export-events').click();
  let csv = await readFile(await (await download).path(), 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(2);
  expect(calls.filter((u) => u.pathname.endsWith('/export')).at(-1).searchParams.get('q')).toBe('EventRef27');
  await search.fill('Record created');
  await expect(panel).toContainText('Page 1 · Rows 1–25');
  download = page.waitForEvent('download');
  await page.getByTestId('button-activity-export-events').click();
  csv = await readFile(await (await download).path(), 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(29);
  expect(csv).not.toContain('EventRef');
  await search.fill('no-such-event');
  await expect(panel).toContainText('No events found');
  await expect(panel).toContainText('No rows · Page 1');
  await expect(panel.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Next page' })).toBeDisabled();
});

test('activity pending search and export cannot release stale results or downloads', async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByTestId('tab-activity-events').click();
  let pending, intercepted;
  const started = new Promise((resolve) => { intercepted = resolve; });
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.route('**/reporting/events/export*', async (route) => {
    pending = [route, await route.fetch()];
    intercepted();
  });
  await page.getByTestId('button-activity-export-events').click();
  await started;
  await page.getByTestId('input-activity-event-search').fill('no-such-activity-query');
  await expect(page.getByTestId('status-activity-export')).toContainText('cancelled');
  await pending[0].fulfill({ response: pending[1] }).catch(() => {});
  await expect(page.getByTestId('panel-activity-events')).toContainText('No events found');
  expect(downloads).toHaveLength(0);
});
