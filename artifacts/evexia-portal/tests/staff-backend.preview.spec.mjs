import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
// These scenarios include repeated authenticated navigations and four footer
// layouts per state, rather than a single short interaction.
test.setTimeout(120000);
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const legacy = '[{"name":"Untouched legacy marker","id":"sample-staff-1"}]';
const batchScope = 'Export includes this loaded batch only. Search directory for other records.';
const searchScope = 'Export includes this loaded search section only, not the whole directory.';

async function expectSingleSearch(page) {
  const directory = page.getByRole('region', { name: 'Staff directory', exact: true });
  await expect(directory.locator('input')).toHaveCount(1);
  await expect(page.getByTestId('input-directory-search-staff')).toBeVisible();
  await expect(page.getByTestId('button-directory-search-staff')).toBeVisible();
  await expect(page.getByTestId('input-search-staff')).toHaveCount(0);
  await expect(page.getByPlaceholder('Filter only loaded records')).toHaveCount(0);
}

async function downloadStaffCSV(page) {
  const event = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  return readFile(await (await event).path(), 'utf8');
}

async function expectFooter(page, summary, scope) {
  const footer = page.getByTestId('staff-batch-footer');
  await expect(footer).toBeVisible();
  await expect(page.getByTestId('text-staff-batch-summary')).toHaveText(summary);
  await expect(footer.locator('p')).toHaveText(scope);
  await expect(page.getByText('Legacy browser-local staff records are retained untouched but are not shown or imported. CSV import and email invitations are unavailable.', { exact: true })).toHaveCount(0);
  await expect(footer.locator('nav')).toHaveCount(1);
  await expect(footer.locator('.admin-pagination')).toHaveCount(0);
}

async function inspectFooterLayouts(page, state) {
  const originalViewport = page.viewportSize();
  for (const appearance of ['light', 'dark']) {
    await page.evaluate(async (value) => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('appearance', value);
    }, appearance);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expectSingleSearch(page);
      const footer = page.getByTestId('staff-batch-footer');
      await footer.scrollIntoViewIfNeeded();
      const layout = await footer.evaluate((element) => {
        const rect = (node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        };
        const summary = element.querySelector('.admin-staff-batch-footer__summary');
        const controls = element.querySelector('nav');
        return {
          footer: rect(element), summary: rect(summary), controls: rect(controls),
          buttons: [...controls.querySelectorAll('button')].map(rect),
          textAlign: getComputedStyle(summary).textAlign,
          border: getComputedStyle(element).borderTopWidth,
          clipped: element.scrollWidth > element.clientWidth,
        };
      });
      expect(layout.textAlign).toBe('left');
      expect(layout.border).toBe('1px');
      expect(layout.clipped).toBe(false);
      for (const box of [layout.summary, ...layout.buttons]) {
        expect(box.x).toBeGreaterThanOrEqual(layout.footer.x + 15);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.footer.x + layout.footer.width - 15);
        expect(box.y).toBeGreaterThanOrEqual(layout.footer.y + 15);
        expect(box.y + box.height).toBeLessThanOrEqual(layout.footer.y + layout.footer.height - 15);
      }
      if (width === 375) {
        expect(layout.footer.x).toBeGreaterThanOrEqual(0);
        expect(layout.controls.y).toBeGreaterThanOrEqual(layout.summary.y + layout.summary.height + 15);
        expect(layout.footer.x + layout.footer.width).toBeLessThanOrEqual(width);
      } else {
        expect(Math.abs(layout.controls.y + layout.controls.height / 2 - layout.summary.y - layout.summary.height / 2)).toBeLessThan(2);
      }
      await footer.screenshot({ path: `/tmp/evexia-staff-footer-${state}-${appearance}-${width}.png` });
    }
  }
  await page.setViewportSize(originalViewport);
  await page.evaluate(async () => {
    const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
    setAdminPreference('appearance', 'light');
  });
}

async function open(page) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible({ timeout: 15000 });
  await page.evaluate(async (raw) => {
    localStorage.setItem('evexia.admin.staff.v1', raw);
    const { listDesignations, createDesignation } = await import('/src/services/serverDesignations.js');
    const { items } = await listDesignations({ query: 'Synthetic Executive', status: 'all', limit: 100 });
    if (!items.some((row) => row.name === 'Synthetic Executive')) await createDesignation({ name: 'Synthetic Executive', shortName: 'SE', status: 'active' });
  }, legacy);
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId('button-add-staff')).toBeEnabled({ timeout: 15000 });
  await expectSingleSearch(page);
}
async function fill(page, suffix, country = 'IN', phone = '9876543210') {
  await page.getByTestId('input-staff-name').fill(`Fictional ${suffix}`);
  await page.getByTestId('input-staff-email').fill(`fictional-${suffix}@example.com`);
  await page.getByTestId('input-staff-phone').fill(phone);
  await page.getByLabel('Phone country code').selectOption(country);
  await page.getByTestId('select-staff-designation').selectOption('Synthetic Executive');
  await page.getByTestId('input-staff-dateOfJoining').fill('2025-01-15');
}
async function create(page, suffix, country, phone) {
  await page.getByTestId('button-add-staff').click();
  await expect(page.getByTestId('input-staff-userId')).toHaveValue('');
  await expect(page.getByTestId('input-staff-userId')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('input-staff-password')).toHaveCount(0);
  await expect(page.getByTestId('checkbox-staff-invitation')).toHaveCount(0);
  await fill(page, suffix, country, phone);
  const response = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/staff') && response.request().method() === 'POST');
  await page.getByTestId('button-save-staff').click();
  const saved = await (await response).json();
  await expect(page.getByRole('dialog')).toContainText('One-time staff credentials');
  await expect(page.getByTestId('text-staff-credential-password')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('text-staff-credential-id')).toHaveValue(saved.record.userId);
  await page.getByTestId('button-reveal-staff-credentials').click();
  await expect(page.getByTestId('text-staff-credential-password')).toHaveValue(saved.initial_password);
  return saved;
}

test('empty database never renders or imports local staff; server credentials, edits, stale conflicts and exports are safe', async ({ page, context }) => {
  await open(page);
  await expect(page.getByTestId('status-staff-empty')).toContainText('No staff members yet');
  await expectFooter(page, 'No staff records yet', batchScope);
  await expect(page.getByRole('button', { name: 'Previous batch', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next batch', exact: true })).toBeDisabled();
  await inspectFooterLayouts(page, 'empty');
  await expect(page.getByText('Untouched legacy marker')).toHaveCount(0);
  await expect(page.getByTestId('button-import-staff')).toBeDisabled();
  const saved = await create(page, 'desktop');
  const row = saved.record;
  expect(row.userId).toMatch(/^st_[a-f0-9]{28}$/);
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stores).not.toContain(saved.initial_password);
  expect(stores).not.toContain('fictional-desktop@example.com');
  expect(stores).not.toContain('9876543210');
  await page.getByTestId('button-close-staff-credentials').click();
  await page.reload();
  await expect(page.getByTestId(`text-staff-name-${row.id}`)).toHaveText('Fictional desktop');
  await expectFooter(page, 'Server records 1–1', batchScope);
  await inspectFooterLayouts(page, 'populated');
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  await page.getByTestId(`button-edit-staff-${row.id}`).click();
  await expect(page.getByTestId('input-staff-userId')).toHaveValue(row.userId);
  await page.getByTestId('input-staff-name').fill('Fictional desktop revised');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(`text-staff-name-${row.id}`)).toHaveText('Fictional desktop revised');
  await page.getByTestId(`button-edit-staff-${row.id}`).click();
  await page.getByTestId('input-staff-name').fill('Preserved stale draft');
  const other = await context.newPage();
  await other.goto(`${base()}/admin/staff`);
  await expect(other.getByTestId(`switch-staff-status-${row.id}`)).toBeVisible();
  await other.getByTestId(`switch-staff-status-${row.id}`).click();
  await expect(other.getByTestId(`switch-staff-status-${row.id}`)).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('record changed');
  await expect(page.getByTestId('input-staff-name')).toHaveValue('Preserved stale draft');
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await page.getByRole('button', { name: 'Review current record' }).click();
  await expect(page.getByRole('dialog')).toContainText('Fictional desktop revised');
  await page.getByTestId('button-cancel-staff').click();
  await other.close();
  await page.reload();
  await expect(page.getByTestId(`switch-staff-status-${row.id}`)).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('input-directory-search-staff').fill(row.userId);
  await page.getByTestId('button-directory-search-staff').click();
  await expectFooter(page, '1 match loaded in this section', searchScope);
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  expect(csv).toContain(row.userId);
  expect(csv).not.toContain(saved.initial_password);
  expect(csv).not.toContain(row.id);
  expect(csv).not.toMatch(/password|hash|createdBy/i);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
  await page.screenshot({ path: '/tmp/evexia-staff-backend-desktop.png', fullPage: true });
});

test('retryable failures preserve drafts; ambiguous creates are not repeated; duplicate emails reject on server', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-add-staff').click();
  await fill(page, 'failure');
  const outage = (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'staff_unavailable' } }) }) : route.continue();
  await page.route('**/api/v1/admin/staff', outage);
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('unavailable');
  await expect(page.getByTestId('input-staff-name')).toHaveValue('Fictional failure');
  await expect(page.getByTestId('button-save-staff')).toBeEnabled();
  await page.unroute('**/api/v1/admin/staff', outage);
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByRole('dialog')).toContainText('One-time staff credentials');
  await page.getByTestId('button-close-staff-credentials').click();
  await page.getByTestId('button-add-staff').click();
  await fill(page, 'failure');
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('already exists');
  await page.getByTestId('input-staff-email').fill('fictional-ambiguous@example.com');
  let writes = 0;
  await page.route('**/api/v1/admin/staff', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes += 1;
    await route.abort('failed');
  });
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByTestId('status-staff-save-error')).toContainText('outcome could not be confirmed');
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await expect(page.getByTestId('input-staff-email')).toHaveValue('fictional-ambiguous@example.com');
  expect(writes).toBe(1);
});

test('shared mobile form retains phone countries and clears one-time credentials on navigation and logout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  for (const [country, phone, full] of [['US', '2025550123', '+12025550123'], ['GB', '7700900123', '+447700900123'], ['AE', '501234567', '+971501234567']]) {
    const saved = await create(page, `mobile-${country}`, country, phone);
    await page.getByTestId('button-close-staff-credentials').click();
    const record = saved.record;
    await expect(page.getByTestId(`link-staff-mobile-phone-${record.id}`)).toHaveText(full);
    await page.getByTestId(`card-staff-${record.id}`).getByRole('button', { name: `Edit ${record.name}`, exact: true }).click();
    await expect(page.getByTestId('input-staff-userId')).toHaveValue(record.userId);
    await expect(page.getByLabel('Phone country code')).toHaveValue(country);
    for (const control of [page.getByTestId('input-staff-userId'), page.getByTestId('input-staff-phone'), page.getByLabel('Phone country code')]) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    await page.getByTestId('button-cancel-staff').click();
  }
  await create(page, 'navigation');
  await page.goto(`${base()}/admin`);
  // A full navigation restores/rotates the refresh cookie. Do not interrupt it
  // with another hard navigation before the new authenticated page is ready.
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  await create(page, 'session-end');
  // End the actual session from another tab, while the credential dialog is open.
  const other = await page.context().newPage();
  await other.goto(`${base()}/admin`);
  await expect(other.getByTestId('button-admin-profile')).toBeVisible();
  await other.evaluate(async () => { const { logoutAdmin } = await import('/src/auth/adminSession.js'); await logoutAdmin(); });
  await expect(page.getByTestId('text-staff-credential-password')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
});

// Hold only the synthetic search response; authentication, session broadcasts
// and the application's AbortSignal remain real.
async function delayedStaffSearch(page) {
  let batchLoads = 0;
  let searchLoads = 0;
  let release;
  let started;
  let finished;
  const gate = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  const delivered = new Promise((resolve) => { finished = resolve; });
  const query = 'abandoned-search@example.com';
  const record = (id, name, email) => ({
    id, name, email, userId: `st_${id}`, phone: '9876543210', dialCountry: 'IN',
    role: 'Staff', designation: 'Synthetic Executive', dateOfJoining: '2025-01-15',
    status: 'active', version: 1,
    createdBy: 'Synthetic Admin', updatedBy: 'Synthetic Admin',
    createdAt: '2025-01-15T00:00:00Z', updatedAt: '2025-01-15T00:00:00Z',
  });
  await page.route('**/api/v1/admin/staff?*', (route) => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('?limit=100&offset=0');
    batchLoads += 1;
    return route.fulfill({ json: {
      items: [record(`batch-${batchLoads}`, `Fresh directory batch ${batchLoads}`, `batch-${batchLoads}@example.com`)],
      has_more: false,
    } });
  });
  await page.route('**/api/v1/admin/staff/search', async (route) => {
    searchLoads += 1;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ query, cursor: null, limit: 100 });
    started(route.request());
    await gate;
    try {
      await route.fulfill({ json: {
        items: [record('late-search', 'Abandoned search record', query)],
        has_more: false, next_cursor: null, scanned: 1,
      } });
    } finally { finished(); }
  });
  return {
    query, requested,
    release: async () => { release(); await delivered; },
    counts: () => ({ batchLoads, searchLoads }),
  };
}

async function submitDelayedSearch(page, delayed) {
  await expect(page.getByTestId('text-staff-name-batch-1')).toHaveText('Fresh directory batch 1');
  await page.getByTestId('input-directory-search-staff').fill(delayed.query);
  await page.getByTestId('button-directory-search-staff').click();
  const request = await delayed.requested;
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('Checking this section');
  await expect(page.getByTestId('text-staff-name-batch-1')).toHaveCount(0);
  await expect(page.getByTestId('button-export-staff')).toBeDisabled();
  return request;
}

async function expectFreshDirectory(page, delayed) {
  await expect(page.getByTestId('text-staff-name-batch-2')).toHaveText('Fresh directory batch 2');
  await expect(page.getByTestId('input-directory-search-staff')).toHaveValue('');
  await expect(page.getByTestId('status-directory-search-staff')).toHaveCount(0);
  await expect(page.getByTestId('text-staff-name-late-search')).toHaveCount(0);
  await expectFooter(page, 'Server records 1–1', batchScope);
  expect(delayed.counts()).toEqual({ batchLoads: 2, searchLoads: 1 });
  const csv = await downloadStaffCSV(page);
  expect(csv).toContain('batch-2@example.com');
  expect(csv).not.toContain(delayed.query);
  expect(csv).not.toContain('Abandoned search record');
}

test('delayed staff search is aborted on SPA navigation and cannot overwrite a newly mounted directory', async ({ page }) => {
  const delayed = await delayedStaffSearch(page);
  await open(page);
  const request = await submitDelayedSearch(page, delayed);
  const aborted = page.waitForEvent('requestfailed', { predicate: (failed) => failed === request });
  try {
    // Use sidebar links, not hard navigation: retain the same JS session.
    await page.getByTestId('link-admin-brand').click();
    await expect(page).toHaveURL(`${base()}/admin`);
    await expect(page.getByTestId('button-admin-profile')).toBeVisible();
    await expect(page.getByTestId('input-directory-search-staff')).toHaveCount(0);
    await aborted;
    expect(request.failure().errorText).toContain('ERR_ABORTED');
    await page.getByTestId('button-toggle-user-management').click();
    await page.getByTestId('link-admin-staff').click();
    await expectFreshDirectory(page, delayed);
    // The abandoned response is released only after the replacement page's
    // fresh batch is visible; it must not restore the old term or records.
    await delayed.release();
    await expectFreshDirectory(page, delayed);
  } finally { await delayed.release(); }
});

test('delayed staff search stays cleared after cross-tab logout and a fresh sign-in', async ({ page, context }) => {
  const delayed = await delayedStaffSearch(page);
  await open(page);
  const other = await context.newPage();
  await other.goto(`${base()}/admin`);
  await expect(other.getByTestId('button-admin-profile')).toBeVisible();
  const request = await submitDelayedSearch(page, delayed);
  const aborted = page.waitForEvent('requestfailed', { predicate: (failed) => failed === request });
  try {
    await other.evaluate(async () => {
      const { logoutAdmin } = await import('/src/auth/adminSession.js');
      await logoutAdmin();
    });
    await expect(page.getByTestId('button-submit-login')).toBeVisible();
    await aborted;
    expect(request.failure().errorText).toContain('ERR_ABORTED');
    await delayed.release();
    await expect(page.getByTestId('button-submit-login')).toBeVisible();
    await expect(page.getByTestId('input-directory-search-staff')).toHaveCount(0);
    await expect(page.getByTestId('status-directory-search-staff')).toHaveCount(0);
    await expect(page.getByTestId('text-staff-name-late-search')).toHaveCount(0);
    await expect(page.getByText(delayed.query, { exact: false })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(delayed.query);
    await other.close();
    await open(page);
    await expectFreshDirectory(page, delayed);
  } finally { await delayed.release(); }
});

test('directory search finds beyond the loaded batch, continues empty sections, retries and never stores terms', async ({ page }) => {
  execFileSync('python3', ['scripts/seed-staff-search-preview.py']);
  const initialBatch = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/staff?limit=100&offset=0'));
  await open(page);
  const loadedBatch = (await (await initialBatch).json()).items;
  await expect(page.getByText('Directory Preview 605', { exact: true })).toHaveCount(0);
  await expectFooter(page, 'Server records 1–100', batchScope);
  await page.getByRole('combobox', { name: 'Rows per page', exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-staff-count')).toContainText('Showing 11–20');
  await page.getByRole('button', { name: 'Next batch', exact: true }).click();
  await expect(page.getByTestId('text-staff-batch-summary')).toHaveText('Server records 101–200');
  await expect(page.getByTestId('text-staff-count')).toContainText('Showing 1–10');
  await page.getByRole('button', { name: 'Previous batch', exact: true }).click();
  await expect(page.getByTestId('text-staff-batch-summary')).toHaveText('Server records 1–100');
  const input = page.getByTestId('input-directory-search-staff');
  const searchRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/admin/staff/search')) searchRequests.push(request.postDataJSON());
  });
  for (const query of ['', 'x', ' x ']) {
    await input.fill(query);
    await expect(page.getByTestId('button-directory-search-staff')).toBeDisabled();
  }
  // Typing must neither request a search nor filter the loaded batch.
  await input.fill('preview-search-605@example.com');
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 1–10 of 100 staff members in loaded batch');
  await expect(page.getByText('Directory Preview 1', { exact: true }).first()).toBeVisible();
  const batchCSV = await downloadStaffCSV(page);
  expect(batchCSV.trim().split('\r\n')).toHaveLength(101);
  // Earlier scenarios also created staff. Verify the actual server batch,
  // rather than assuming all 100 records come from the search seed.
  for (const record of loadedBatch) expect(batchCSV).toContain(record.userId);
  expect(batchCSV).not.toContain('preview-search-101@example.com');
  expect(batchCSV).not.toContain('preview-search-605@example.com');
  expect(searchRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-staff-count')).toContainText('Showing 11–20');
  const requestEvent = page.waitForRequest((request) => request.url().endsWith('/api/v1/admin/staff/search'));
  await page.getByTestId('button-directory-search-staff').click();
  const request = await requestEvent;
  expect(request.method()).toBe('POST');
  expect(request.url()).not.toContain('preview-search-605');
  expect(request.postDataJSON().query).toBe('preview-search-605@example.com');
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await expect(page.getByTestId('status-staff-empty')).toContainText('No matches in this section');
  await expectFooter(page, '0 matches loaded in this section', searchScope);
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 0 of 0 staff matches in loaded section');
  await expect(page.getByTestId('button-export-staff')).toBeDisabled();
  await inspectFooterLayouts(page, 'search-empty');
  await expect(page.getByTestId('button-continue-directory-search-staff')).toBeEnabled();
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByText('Directory Preview 605', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('Search complete');
  await expectFooter(page, '1 match loaded in this section', searchScope);
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 1–1 of 1 staff matches in loaded section');
  await inspectFooterLayouts(page, 'search-populated');
  await expect(page.getByTestId('button-continue-directory-search-staff')).toBeDisabled();
  await expect(page.getByTestId('button-previous-directory-search-staff')).toBeEnabled();
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('button-export-staff').click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  expect(csv).toContain('preview-search-605@example.com');
  expect(csv).not.toContain('preview-search-604@example.com');
  await page.getByTestId('button-previous-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await expect(page.getByTestId('button-previous-directory-search-staff')).toBeDisabled();
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByText('Directory Preview 605', { exact: true }).first()).toBeVisible();
  // Changing the draft query does not hide results or alter export scope.
  await input.fill('different-unsubmitted-term');
  await expect(page.getByText('Directory Preview 605', { exact: true }).first()).toBeVisible();
  expect(await downloadStaffCSV(page)).toContain('preview-search-605@example.com');
  expect(searchRequests).toHaveLength(4);
  const snapshot = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(snapshot).not.toContain('preview-search-605');
  expect(snapshot).not.toContain('Directory Preview');
  expect(await page.evaluate(() => localStorage.getItem('evexia.admin.staff.v1'))).toBe(legacy);
  await page.screenshot({ path: '/tmp/evexia-staff-directory-search.png', fullPage: true });
  await input.fill('not-present-in-directory');
  let fail = true;
  await page.route('**/api/v1/admin/staff/search', (route) => {
    if (fail) { fail = false; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"staff_unavailable"}}' }); }
    return route.continue();
  });
  await page.getByTestId('button-directory-search-staff').click();
  await expect(page.getByTestId('button-retry-staff')).toBeVisible();
  await expect(page.getByTestId('button-export-staff')).toBeDisabled();
  await page.getByTestId('button-retry-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('Search complete');
  await expect(page.getByTestId('status-staff-empty')).toContainText('No matches in this final section');
  await expectFooter(page, '0 matches loaded in this section', searchScope);
  await page.getByTestId('button-restart-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('500 records checked');
  await expect(page.getByTestId('button-previous-directory-search-staff')).toBeDisabled();
  await expect(page.getByTestId('button-continue-directory-search-staff')).toBeEnabled();
  await page.getByTestId('button-clear-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toHaveCount(0);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Next batch', exact: true })).toBeEnabled();
  await expectFooter(page, 'Server records 1–100', batchScope);
  // A multi-page section exports all loaded matches, not just its visible page
  // or matches from other sections. Continuation remains a manual action.
  await input.fill('Directory Preview');
  await page.getByTestId('button-directory-search-staff').click();
  await expectFooter(page, '100 matches loaded in this section', searchScope);
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 1–10 of 100 staff matches in loaded section');
  const firstCSV = await downloadStaffCSV(page);
  expect(firstCSV.trim().split('\r\n')).toHaveLength(101);
  expect(firstCSV).toContain('preview-search-1@example.com');
  expect(firstCSV).toContain('preview-search-100@example.com');
  expect(firstCSV).not.toContain('preview-search-101@example.com');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('text-staff-count')).toContainText('Showing 11–20');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectSingleSearch(page);
  await expect(page.locator('.admin-staff-mobile [role="listitem"]')).toHaveCount(10);
  await page.getByTestId('button-continue-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('200 records checked');
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 1–10 of 100 staff matches in loaded section');
  await expect(page.locator('.admin-staff-mobile [role="listitem"]').first()).toContainText('Directory Preview 101');
  const secondCSV = await downloadStaffCSV(page);
  expect(secondCSV.trim().split('\r\n')).toHaveLength(101);
  expect(secondCSV).toContain('preview-search-101@example.com');
  expect(secondCSV).toContain('preview-search-200@example.com');
  expect(secondCSV).not.toContain('preview-search-100@example.com');
  expect(secondCSV).not.toContain('preview-search-201@example.com');
  await page.getByTestId('button-previous-directory-search-staff').click();
  await expect(page.getByTestId('status-directory-search-staff')).toContainText('100 records checked');
  await expect(page.locator('.admin-staff-mobile [role="listitem"]').first()).toContainText('Directory Preview 1');
  await page.getByTestId('button-clear-directory-search-staff').click();
  await expect(page.getByTestId('text-staff-count')).toHaveText('Showing 1–10 of 100 staff members in loaded batch');
  await expectSingleSearch(page);
});

// Shared fixtures do not reset between spec files, and Playwright's file order
// need not match CLI argument order. Keep staff-producing cross-master scenarios
// after this file's existing empty-directory assertion.
test('staff preserves unavailable designation and choice outages keep mounted draft with retry', async ({ page }, testInfo) => {
  await open(page);
  const staff = await page.evaluate(async () => {
    return (await import('/src/services/staff.js')).createStaff({ name: 'Synthetic designation preservation', email: 'designation-preserved@example.com',
      phone: '9876543210', dialCountry: 'IN', status: 'active', role: 'Staff', designation: 'Unavailable saved designation', dateOfJoining: '2026-01-01' });
  });
  await page.goto(`${base()}/admin/staff`);
  await expect(page.getByTestId(`button-edit-staff-${staff.record.id}`)).toBeEnabled();
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
  await page.route('**/api/v1/admin/designations?*', (route) => route.fulfill({ status: 503, json: { error: { code: 'designation_unavailable', message: 'Choices temporarily unavailable.' } } }));
  await page.getByTestId(`button-edit-staff-${staff.record.id}`).click();
  await expect(page.getByTestId('select-staff-designation')).toHaveValue('Unavailable saved designation');
  await page.getByTestId('input-staff-name').fill('Mounted staff draft');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Choices temporarily unavailable');
  await expect(page.getByTestId('button-save-staff')).toBeDisabled();
  await page.unroute('**/api/v1/admin/designations?*');
  await page.getByRole('button', { name: 'Retry designation choices (keep draft)' }).click();
  await expect(page.getByTestId('input-staff-name')).toHaveValue('Mounted staff draft');
  await expect(page.getByTestId('button-save-staff')).toBeEnabled();
  await expect(page.getByTestId('select-staff-designation')).toHaveValue('Unavailable saved designation');
  await page.screenshot({ path: testInfo.outputPath('designation-staff-choices.jpg') });
});
