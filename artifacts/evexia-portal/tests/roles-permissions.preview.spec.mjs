import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => {
  if (!process.env.EVEXIA_PREVIEW_BASE_URL) throw Error('Use the isolated authenticated preview harness.');
  return process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
};
async function open(page) {
  await page.goto(`${base()}/admin/roles-permissions`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-add-role')).toBeEnabled();
}
async function clearRoles(page) {
  await page.evaluate(async () => {
    const { listRoles, deleteRole } = await import('/src/services/rolePermissions.js');
    // Read all pages first so deletion cannot invalidate the scan.
    let cursor = null, rows = [];
    do {
      const data = await listRoles(cursor);
      rows.push(...data.items);
      cursor = data.next_cursor;
    } while (cursor);
    for (const row of rows) await deleteRole(row.id, row.version);
  });
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.getByTestId('status-roles-empty')).toBeVisible();
}
async function create(page, name, description = '') {
  await page.getByTestId('button-add-role').click();
  await page.getByTestId('input-role-name').fill(name);
  await page.getByTestId('input-role-description').fill(description);
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/roles' && r.request().method() === 'POST');
  await page.getByTestId('button-create-role').click();
  const row = await (await response).json();
  await expect(page.getByTestId('text-active-role')).toHaveText(name.trim());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return row;
}
async function remove(page) {
  await page.getByTestId('button-delete-role').click();
  await expect(page.getByRole('dialog')).toContainText('cannot be deleted');
  await page.getByTestId('button-confirm-delete-role').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('button-add-role')).toBeEnabled();
}

test('fresh empty state, validated CRUD, persistence, cross-tab reads, last deletion and server audit', async ({ page, context }, testInfo) => {
  await open(page);
  await expect(page.getByTestId('status-roles-empty')).toContainText('No roles yet');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText('Grant all', { exact: true })).toHaveCount(0);
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  await page.getByTestId('button-add-role').click();
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('text-role-error')).toHaveText('Enter a role name.');
  await page.getByTestId('input-role-name').fill('x'.repeat(101));
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('text-role-error')).toContainText('100 characters');
  await page.getByTestId('button-cancel-role').click();
  const row = await create(page, ' Synthetic Reviewer ', ' Review team only. ');
  expect(row.permissions).toEqual([]);
  await expect(page.getByTestId('text-permission-count')).toHaveText('0 permissions');
  await page.getByTestId('button-add-role').click();
  await page.getByTestId('input-role-name').fill(' synthetic reviewer ');
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('status-role-save-error')).toContainText('already exists');
  await page.getByTestId('button-cancel-role').click();
  await page.reload();
  await expect(page.getByTestId('text-active-role')).toHaveText('Synthetic Reviewer');
  const other = await context.newPage();
  await other.goto(`${base()}/admin/roles-permissions`);
  await expect(other.getByTestId('text-active-role')).toHaveText('Synthetic Reviewer');
  await page.getByTestId('button-edit-role').click();
  await page.getByTestId('input-role-description').fill('Revised description');
  await page.getByTestId('button-save-role').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await other.getByTestId('button-refresh-roles').click();
  await expect(other.locator('.rp-meta')).toContainText('Revised description');
  await other.close();
  await page.screenshot({ path: testInfo.outputPath('roles-metadata-desktop.png'), fullPage: true });
  await page.getByTestId('button-delete-role').click();
  await page.getByTestId('button-cancel-role').click();
  await expect(page.getByTestId('text-active-role')).toHaveText('Synthetic Reviewer');
  await remove(page);
  await expect(page.getByTestId('status-roles-empty')).toBeVisible();
  const next = await create(page, 'Super Admin', 'Business metadata only');
  expect(next.permissions).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).toBe(stores);
  const events = await page.evaluate(async () => {
    const { reportingRequest } = await import('/src/auth/adminSession.js');
    return (await reportingRequest('events', { q: 'Custom role', limit: 100 })).items;
  });
  const mutations = events.filter((e) => e.resource_id === row.id);
  expect(mutations.map((e) => e.action).sort()).toEqual(['role_create', 'role_delete', 'role_update']);
  for (const event of mutations) {
    expect(event.outcome).toBe('success');
    expect(event.reason).not.toBe('browser_reported');
    expect(event.session_id).toBeTruthy();
    expect(event.request_id).toBeTruthy();
  }
  await page.goto(`${base()}/admin/activity-logs`);
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('Role created', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Role deleted', { exact: true })).toBeVisible();
});

test('stale edits preserve drafts and require review; deleted records never recreate', async ({ page, context }) => {
  await open(page);
  await clearRoles(page);
  const row = await create(page, 'Conflict Role');
  await page.getByTestId('button-edit-role').click();
  await page.getByTestId('input-role-name').fill('Retained draft');
  const other = await context.newPage();
  await other.goto(`${base()}/admin/roles-permissions`);
  await expect(other.getByTestId('text-active-role')).toHaveText('Conflict Role');
  await other.getByTestId('button-edit-role').click();
  await other.getByTestId('input-role-description').fill('Another tab update');
  await other.getByTestId('button-save-role').click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-save-role').click();
  await expect(page.getByTestId('status-role-save-error')).toContainText('changed');
  await expect(page.getByTestId('input-role-name')).toHaveValue('Retained draft');
  await expect(page.getByTestId('button-save-role')).toBeDisabled();
  await page.getByTestId('button-review-current').click();
  await expect(page.getByTestId('text-current-role')).toContainText('Another tab update');
  await page.getByTestId('button-adopt-current').click();
  await page.getByTestId('button-save-role').click();
  await expect(page.getByTestId('text-active-role')).toHaveText('Retained draft');
  await page.getByTestId('button-delete-role').click();
  await other.getByTestId('button-refresh-roles').click();
  await other.getByTestId('button-edit-role').click();
  await other.getByTestId('input-role-description').fill('Changed before delete');
  await other.getByTestId('button-save-role').click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('button-confirm-delete-role').click();
  await expect(page.getByTestId('text-role-error')).toContainText('changed');
  await expect(page.getByTestId('button-confirm-delete-role')).toBeDisabled();
  await page.getByTestId('button-cancel-role').click();
  await page.getByTestId('button-refresh-roles').click();
  await page.getByTestId('button-edit-role').click();
  await page.getByTestId('input-role-description').fill('Deleted draft kept');
  await remove(other);
  await page.getByTestId('button-save-role').click();
  await expect(page.getByTestId('status-role-save-error')).toContainText('deleted');
  await expect(page.getByTestId('input-role-description')).toHaveValue('Deleted draft kept');
  await expect(page.getByTestId('button-save-role')).toBeDisabled();
  await page.getByTestId('button-cancel-role').click();
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.getByTestId('status-roles-empty')).toBeVisible();
  await other.close();
  expect(row.version).toBe(1);
});

test('loading and unavailable are distinct; failed and lost saves keep drafts without replay', async ({ page }) => {
  await open(page);
  await clearRoles(page);
  const outage = (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"roles_unavailable"}}' })
    : route.continue();
  await page.route('**/api/v1/admin/roles?*', outage);
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.getByTestId('status-roles-unavailable')).toBeVisible();
  await expect(page.getByTestId('status-roles-empty')).toHaveCount(0);
  await expect(page.getByTestId('button-add-role')).toBeDisabled();
  await page.unroute('**/api/v1/admin/roles?*', outage);
  let release, started;
  const wait = new Promise((resolve) => { started = resolve; });
  await page.route('**/api/v1/admin/roles?*', async (route) => {
    started(); await new Promise((resolve) => { release = resolve; }); await route.continue();
  });
  await page.getByTestId('button-refresh-roles').click();
  await wait;
  await expect(page.getByTestId('status-roles-loading')).toBeVisible();
  release();
  await expect(page.getByTestId('button-add-role')).toBeEnabled();
  await page.unroute('**/api/v1/admin/roles?*');
  await page.getByTestId('button-add-role').click();
  await page.getByTestId('input-role-name').fill('Retry Draft');
  const fail = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"roles_unavailable"}}' });
  await page.route('**/api/v1/admin/roles', fail);
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('status-role-save-error')).toContainText('unavailable');
  await expect(page.getByTestId('input-role-name')).toHaveValue('Retry Draft');
  await expect(page.getByTestId('button-create-role')).toBeEnabled();
  await page.unroute('**/api/v1/admin/roles', fail);
  let writes = 0;
  await page.route('**/api/v1/admin/roles', async (route) => {
    writes++;
    await route.fetch(); // Actually commit, then lose the response.
    await route.abort('failed');
  });
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('status-role-save-error')).toContainText('outcome could not be confirmed');
  await expect(page.getByTestId('button-create-role')).toBeDisabled();
  expect(writes).toBe(1);
  await page.unroute('**/api/v1/admin/roles');
  await page.getByTestId('button-refresh-draft-roles').click();
  await expect(page.getByTestId('button-create-role')).toBeEnabled();
  await page.getByTestId('button-cancel-role').click();
  await expect(page.getByTestId('text-active-role')).toHaveText('Retry Draft');
  await page.reload();
  await expect(page.getByTestId('text-active-role')).toHaveText('Retry Draft');
});

test('full bounded directory navigation, sidebar and responsive zero-permission workspace', async ({ page }, testInfo) => {
  await open(page);
  await clearRoles(page);
  await page.evaluate(async () => {
    const { createRole } = await import('/src/services/rolePermissions.js');
    for (let n = 0; n < 52; n++) await createRole({ name: `Directory Role ${n}`, description: '' });
  });
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.locator('.rp-role')).toHaveCount(50);
  await page.getByTestId('button-next-roles').click();
  await expect(page.locator('.rp-role')).toHaveCount(2);
  await expect(page.getByTestId('button-next-roles')).toBeDisabled();
  await page.getByTestId('button-previous-roles').click();
  await expect(page.locator('.rp-role')).toHaveCount(50);
  await expect(page.getByTestId('link-admin-roles-permissions')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('input-search-navigation').fill('permissions');
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeVisible();
  await expect(page.getByTestId('link-admin-staff')).toHaveCount(0);
  await page.getByTestId('button-clear-navigation-search').click();
  for (const [width, theme, appearance] of [[1440, 'classic', 'light'], [375, 'modern', 'dark']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async ({ theme, appearance }) => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('theme', theme); setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    if (width < 900) {
      await expect(page.getByTestId('button-open-navigation')).toBeVisible();
      await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
      await page.getByTestId('text-active-role').scrollIntoViewIfNeeded();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`roles-${width}.png`), fullPage: false });
  }
  await clearRoles(page);
});
