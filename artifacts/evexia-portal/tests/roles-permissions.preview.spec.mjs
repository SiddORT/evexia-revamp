import { test, expect } from '@playwright/test';
import { enlargeRoleText, expectRoleLayoutFits, expectRoleFocusVisible, reachRoleControlByKeyboard } from './helpers/rolesPermissionsLayout.mjs';
import { randomUUID } from 'node:crypto';

// Matrix projects own their launch settings. Never apply Chromium's executable
// to a Firefox/WebKit project.
test.use({
  launchOptions: async ({ browserName }, use, info) => {
    await use(info.project.use.launchOptions || (browserName === 'chromium' && process.env.EVEXIA_CHROMIUM_PATH
      ? { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } : {}));
  },
});
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
  await expect(page.getByRole('tab', { name: 'Roles', exact: true })).toHaveAttribute('aria-selected', 'true');
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
  const selectedName = await page.getByTestId('text-active-role').textContent();
  await page.getByTestId('tab-permissions').click();
  await page.getByTestId('checkbox-permission-zone.add').check();
  await page.getByTestId('tab-roles').click();
  await page.getByTestId('button-next-roles').click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Unsaved permission changes');
  await page.getByTestId('button-keep-editing-permissions').click();
  await page.getByTestId('tab-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.add')).toBeChecked();
  await page.getByTestId('button-cancel-permissions').click();
  await page.getByTestId('tab-roles').click();
  await page.getByTestId('button-next-roles').click();
  await expect(page.locator('.rp-role')).toHaveCount(2);
  await expect(page.getByTestId('text-active-role')).toHaveText(selectedName);
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
      await expect.poll(() => page.locator('#admin-navigation').evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      await page.getByTestId('text-active-role').scrollIntoViewIfNeeded();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`roles-${width}.png`), fullPage: false });
  }
  await clearRoles(page);
});

test('confirmed deleted role keeps a draft across tabs until explicit discard', async ({ page }) => {
  await open(page);
  await clearRoles(page);
  const row = await create(page, 'Deleted draft');
  await page.getByTestId('tab-permissions').click();
  await page.getByTestId('checkbox-permission-zone.edit').check();
  await page.evaluate(async (id) => {
    const roles = await import('/src/services/rolePermissions.js');
    const current = await roles.getRole(id);
    await roles.deleteRole(id, current.version);
  }, row.id);
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.getByTestId('status-permissions-deleted')).toBeVisible();
  await page.getByTestId('tab-roles').click();
  await expect(page.getByTestId('text-active-role')).toHaveText(row.name);
  await page.getByTestId('tab-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.edit')).toBeChecked();
  await expect(page.getByTestId('button-save-permissions')).toBeDisabled();
  await page.getByTestId('button-discard-permission-draft').click();
  await expect(page.getByTestId('text-active-role')).toHaveCount(0);
});

test('tabs keep drafts; search and mixed groups use the whole live catalogue; saves persist zero, all and partial grants', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await open(page);
  await clearRoles(page);
  const first = await create(page, 'Tabs Reviewer', 'Saved description and audit details');
  const second = await create(page, 'Tabs Clerk');
  // Sibling controls must not select the card they belong to.
  await page.getByTestId(`button-edit-role-${first.id}`).click();
  await expect(page.getByTestId('input-role-name')).toHaveValue(first.name);
  await page.getByTestId('button-cancel-role').click();
  await expect(page.getByTestId('text-active-role')).toHaveText(second.name);
  await page.getByTestId(`button-role-${first.id}`).click();
  await expect(page.locator('.rp-meta')).toContainText(first.description);
  await expect(page.getByTestId('panel-zone-permissions')).toBeHidden();
  // Roving keyboard tabs, including focus and Home/End.
  await page.getByTestId('tab-roles').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-permissions')).toBeFocused();
  await expect(page.getByTestId('tab-permissions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('checkbox-zone-permissions')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('checkbox-permission-zone.import').check();
  for (const id of ['checkbox-zone-permissions', 'checkbox-masters-permissions']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'mixed');
    expect(await page.getByTestId(id).evaluate((el) => el.indeterminate)).toBe(true);
  }
  await page.getByTestId('input-search-permissions').fill('Export');
  await expect(page.locator('.rp-matrix__grid input')).toHaveCount(8);
  await expect(page.getByTestId('text-selected-permission-count')).toContainText('1 of 40');
  await page.getByTestId('button-permissions-all').click();
  await expect(page.getByTestId('text-selected-permission-count')).toContainText('40 of 40');
  await page.getByTestId('input-search-permissions').fill('No matching grant');
  await expect(page.getByTestId('status-permissions-no-results')).toBeVisible();
  await page.getByTestId('button-permissions-none').click();
  await expect(page.getByTestId('text-selected-permission-count')).toContainText('0 of 40');
  // Even with no visible actions, grouped selection includes all five grants.
  await page.getByTestId('checkbox-zone-permissions').check();
  await expect(page.getByTestId('text-selected-permission-count')).toContainText('5 of 40');
  await page.getByTestId('tab-roles').click();
  await expect(page.getByTestId(`button-role-${first.id}`)).toContainText('0 permissions saved');
  await page.getByTestId('button-edit-role').click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Unsaved permission changes');
  await page.getByTestId('button-keep-editing-permissions').click();
  await page.getByTestId('button-add-role').click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Unsaved permission changes');
  await page.getByTestId('button-keep-editing-permissions').click();
  await page.getByTestId(`button-role-${second.id}`).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Unsaved permission changes');
  await page.getByTestId('button-keep-editing-permissions').click();
  await page.getByTestId('tab-permissions').click();
  await expect(page.getByTestId('input-search-permissions')).toHaveValue('No matching grant');
  await expect(page.getByTestId('text-draft-permission-count')).toContainText('5 of 40');
  await page.getByTestId('panel-zone-permissions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('permissions-workspace-desktop.png'), fullPage: true });
  const save = async (keys) => {
    const response = page.waitForResponse((r) => r.url().endsWith(`/${first.id}/permissions`) && r.request().method() === 'POST');
    await page.getByTestId('button-save-permissions').click();
    const result = await response;
    expect(result.request().postDataJSON().permissions).toEqual(keys);
    expect(result.status()).toBe(200);
    await expect(page.getByTestId('button-save-permissions')).toBeDisabled();
    await expect(page.getByTestId('text-saved-permission-count')).toContainText(`${keys.length} of 40`);
  };
  const keys = ['zone.add', 'zone.edit', 'zone.delete', 'zone.export', 'zone.import'];
  await save(keys);
  await page.getByTestId('button-permissions-none').click();
  await save([]);
  await page.getByTestId('input-search-permissions').fill('');
  await page.getByTestId('checkbox-permission-zone.import').check();
  await save(['zone.import']);
  await page.getByTestId('tab-roles').click();
  await expect(page.getByTestId(`button-role-${first.id}`)).toContainText('1 permission saved');
  await page.getByTestId('button-edit-role').click();
  await page.getByTestId('input-role-description').fill('Metadata only');
  await page.getByTestId('button-save-role').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('tab-roles')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(`button-role-${first.id}`).click();
  await expect(page.locator('.rp-meta')).toContainText('Metadata only');
  await page.getByTestId('tab-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
  await expect(page.getByTestId('text-selected-permission-count')).toContainText('1 of 40');
  for (const [width, theme, appearance] of [[1440, 'classic', 'light'], [375, 'modern', 'dark'], [375, 'classic', 'light']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async ({ theme, appearance }) => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('theme', theme); setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    if (width < 900) {
      await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
      await expect.poll(() => page.locator('#admin-navigation').evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    }
    // Enlarge all page text, including controls whose original sizing uses px.
    await page.addStyleTag({ content: '.rp, .rp-tabs, .rp-scope { font-size: 200%; } .rp *, .rp-tabs * { font-size: inherit !important; }' });
    for (const tab of ['roles', 'permissions']) {
      await page.getByTestId(`tab-${tab}`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByTestId(tab === 'roles' ? 'button-add-role' : 'button-save-permissions').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`tabs-${tab}-${width}-${appearance}-enlarged.png`) });
    }
  }
});

test.describe('@roles-layout focused engine coverage', () => {
  let layoutRole; // Serial projects/one worker; owned only by the current case.
  test.beforeEach(async ({ page, browser, browserName }, info) => {
    if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') throw Error('Disposable authenticated fixture required.');
    const evidence = { project: info.project.name, engine: browserName, version: browser.version(),
      nativeSafari: false };
    console.log(`Roles and Permissions engine: ${JSON.stringify(evidence)}`);
    await info.attach('engine-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
    await open(page);
    // Only this new disposable record is edited, and retry/worker restarts
    // cannot collide with earlier fixture names. No directory-wide deletion.
    layoutRole = await create(page, `Layout Reviewer ${randomUUID()}`, 'Synthetic review team metadata with a longer readable description.');
  });

  test('keyboard tabs, native mixed groups and search-independent selection', async ({ page }) => {
    const roles = page.getByTestId('tab-roles'), permissions = page.getByTestId('tab-permissions');
    const groups = ['checkbox-zone-permissions', 'checkbox-masters-permissions'];
    const expectGroups = async (checked, mixed, mastersState = null) => {
      for (const id of groups) {
        const input = page.getByTestId(id);
        const [groupChecked, groupMixed] = id === 'checkbox-masters-permissions' && mastersState
          ? mastersState : [checked, mixed];
        await expect(input).toHaveAttribute('aria-checked', groupMixed ? 'mixed' : String(groupChecked));
        expect(await input.evaluate((node) => ({
          tag: node.tagName, type: node.type, checked: node.checked, mixed: node.indeterminate,
        }))).toEqual({ tag: 'INPUT', type: 'checkbox', checked: groupChecked, mixed: groupMixed });
      }
    };
    await roles.focus();
    // Establish real keyboard modality. Firefox intentionally keeps a
    // pointer-focused control without :focus-visible after programmatic focus.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expectRoleFocusVisible(roles);
    await expect(roles).toHaveAttribute('tabindex', '0');
    await expect(permissions).toHaveAttribute('tabindex', '-1');
    for (const [key, target, hidden] of [
      ['ArrowRight', permissions, roles], ['ArrowRight', roles, permissions],
      ['ArrowLeft', permissions, roles], ['Home', roles, permissions], ['End', permissions, roles],
    ]) {
      await page.keyboard.press(key);
      await expectRoleFocusVisible(target);
      await expect(target).toHaveAttribute('aria-selected', 'true');
      await expect(target).toHaveAttribute('tabindex', '0');
      await expect(hidden).toHaveAttribute('tabindex', '-1');
      const panelId = await target.getAttribute('aria-controls');
      await expect(page.locator(`#${panelId}`)).toBeVisible();
      await expect(page.locator(`#${await hidden.getAttribute('aria-controls')}`)).toBeHidden();
    }
    await page.keyboard.press('Tab');
    await expect(permissions).not.toBeFocused();
    await expect(roles).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expectRoleFocusVisible(permissions);
    await expectGroups(false, false);
    await page.getByTestId('checkbox-permission-zone.import').check();
    await expectGroups(false, true);
    await page.getByTestId('input-search-permissions').fill('Export');
    await expect(page.locator('.rp-matrix__grid input')).toHaveCount(8);
    await expect(page.getByTestId('text-selected-permission-count')).toContainText('1 of 40');
    // Mixed -> all -> none through the actual native keyboard action.
    for (const id of groups) {
      await page.getByTestId('input-search-permissions').fill('No matching grant');
      await expect(page.getByTestId('status-permissions-no-results')).toBeVisible();
      await reachRoleControlByKeyboard(page, page.getByTestId('input-search-permissions'), page.getByTestId(id));
      await page.keyboard.press('Space');
      await expectRoleFocusVisible(page.getByTestId(id));
      await expectGroups(true, false, id === 'checkbox-zone-permissions' ? [false, true] : null);
      await expect(page.getByTestId('text-selected-permission-count')).toContainText(
        id === 'checkbox-zone-permissions' ? '5 of 40' : '40 of 40');
      await page.keyboard.press('Space');
      await expectGroups(false, false);
      await expect(page.getByTestId('text-selected-permission-count')).toContainText('0 of 40');
      await page.getByTestId('input-search-permissions').fill('');
      await expect(page.locator('.rp-matrix__grid input:checked')).toHaveCount(0);
      await page.getByTestId('checkbox-permission-zone.import').check();
      await expectGroups(false, true);
    }
    await page.getByTestId('input-search-permissions').fill('Export');
    await page.getByTestId('button-permissions-all').click();
    await expectGroups(true, false);
    await page.getByTestId('input-search-permissions').fill('No matching grant');
    await page.getByTestId('button-permissions-none').click();
    await expectGroups(false, false);
    await page.getByTestId('input-search-permissions').fill('');
    await page.getByTestId('checkbox-permission-zone.import').check();
    await roles.click();
    await expect(page.locator('.rp-meta')).toContainText('Synthetic review team metadata');
    await permissions.click();
    await expectGroups(false, true);
    await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
    const saved = page.waitForResponse((r) => r.url().endsWith('/permissions') && r.request().method() === 'POST');
    await page.getByTestId('button-save-permissions').click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().permissions).toEqual(['zone.import']);
    await expect(page.getByTestId('button-save-permissions')).toBeDisabled();
    await page.reload();
    await expect(page.getByTestId('button-add-role')).toBeEnabled();
    await page.getByTestId(`button-role-${layoutRole.id}`).click();
    await expect(page.getByTestId('text-active-role')).toHaveText(layoutRole.name);
    await permissions.click();
    await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
    await expectGroups(false, true);
  });

  for (const width of [1440, 375]) for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    test(`200% text at ${width}px ${theme}/${appearance} in both tabs`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async ({ theme, appearance }) => {
        const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
        setAdminPreference('theme', theme); setAdminPreference('appearance', appearance);
      }, { theme, appearance });
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      if (width < 900) {
        await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
        await expect.poll(() => page.locator('#admin-navigation').evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
      }
      const font = await page.getByTestId('tab-roles').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      const actionFont = await page.getByTestId('button-save-permissions').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      await enlargeRoleText(page);
      expect(await page.getByTestId('tab-roles').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(font * 2);
      expect(await page.getByTestId('button-save-permissions').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(actionFont * 2);
      for (const tab of ['roles', 'permissions']) {
        await page.getByRole('tab', { selected: true }).focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press(tab === 'roles' ? 'Home' : 'End');
        await expectRoleFocusVisible(page.getByTestId(`tab-${tab}`));
        await expectRoleLayoutFits(page);
        await page.screenshot({ path: info.outputPath(`${tab}-200-percent.png`), fullPage: true });
      }
      // Pending counts and enabled actions must also fit; the clean state alone
      // would miss the dynamic draft layout.
      await page.getByTestId('checkbox-permission-zone.import').check();
      await expect(page.getByTestId('button-save-permissions')).toBeEnabled();
      await enlargeRoleText(page); // Include the newly mounted draft count.
      await expectRoleLayoutFits(page);
      await page.getByTestId('button-save-permissions').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('permissions-draft-actions-200-percent.png') });
    });
  }
});
