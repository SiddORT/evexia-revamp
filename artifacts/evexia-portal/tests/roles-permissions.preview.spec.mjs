import { test, expect } from '@playwright/test';
import { ALL_PERMISSION_KEYS, MODULES, permissionKeys, createDemoRoles } from '../src/services/rolePermissions.js';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => {
  if (!process.env.EVEXIA_PREVIEW_BASE_URL) throw Error('Use the isolated authenticated preview harness.');
  return process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
};
const total = ALL_PERMISSION_KEYS.length;
async function open(page) {
  await page.goto(`${base()}/admin/roles-permissions`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  if (!process.env.EVEXIA_TEST_ADMIN_PASSWORD) throw Error('Missing synthetic fixture password.');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('text-active-role')).toHaveText('Demo Coordinator');
}
const count = (page, n) => expect(page.getByTestId('text-permission-count')).toHaveText(`${n}/${total}`);
const stores = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

test('creation, validation, descriptions, independent drafts, save and reload are memory-only', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('note').filter({ hasText: 'UI-only demo roles' })).toContainText('reset on page reload');
  const initialStores = await stores(page);
  await page.evaluate(() => {
    window.rolePreviewStorageWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.rolePreviewStorageWrites.push(method);
        return original.apply(this, args);
      };
    }
  });
  const roleRequests = [];
  const localActivity = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    // Privacy-safe local observations are allowed; role data stays offline.
    if (path === '/api/v1/admin/reporting/activity' && request.method() === 'POST') {
      localActivity.push(request.postDataJSON());
    } else if (path.includes('/api/') && !/\/auth\/(me|refresh)$/.test(path)) roleRequests.push(path);
  });
  await count(page, total);
  await page.getByTestId('button-add-role').click();
  await expect(page.getByTestId('button-close-dialog')).toBeFocused();
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('text-role-error')).toHaveText('Enter a role name.');
  await expect(page.getByTestId('input-role-name')).toBeFocused();
  await page.getByTestId('input-role-name').fill(' demo coordinator ');
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('text-role-error')).toContainText('already exists');
  await page.getByTestId('button-cancel-role').click();
  await expect(page.getByTestId('button-add-role')).toBeFocused();
  await page.getByTestId('button-add-role').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('button-add-role')).toBeFocused();
  await page.getByTestId('button-add-role').click();
  await page.getByTestId('input-role-name').fill('  Fictional Reviewer  ');
  await page.getByTestId('input-role-description').fill('  Fictional review team only.  ');
  await page.getByTestId('button-create-role').click();
  await expect(page.getByTestId('text-active-role')).toHaveText('Fictional Reviewer');
  const newRole = page.locator('.rp-role').filter({ hasText: 'Fictional Reviewer' });
  await expect(newRole).toHaveAttribute('aria-pressed', 'true');
  await expect(newRole).toContainText('Fictional review team only.');
  await count(page, 0);
  await page.getByTestId('checkbox-perm-zones-view').check();
  await count(page, 1);
  await expect(page.getByTestId('status-dirty')).toHaveText('Unsaved changes');
  await page.getByTestId('button-role-demo-reader').click();
  await count(page, createDemoRoles()[2].permissions.length);
  await page.getByTestId('checkbox-perm-zones-view').uncheck();
  await newRole.click();
  await count(page, 1);
  await expect(page.getByTestId('checkbox-perm-zones-view')).toBeChecked();
  await page.getByTestId('button-save-role').click();
  await expect(page.getByTestId('status-save')).toContainText('page memory only');
  await expect(page.getByTestId('status-save')).toContainText('nothing is stored or enforced');
  await expect(page.getByTestId('status-dirty')).toHaveText('Saved snapshot');
  await page.getByTestId('button-role-demo-reader').click();
  await expect(page.getByTestId('checkbox-perm-zones-view')).not.toBeChecked();
  await newRole.click();
  await expect(page.getByTestId('status-dirty')).toHaveText('Saved snapshot');
  expect(await stores(page)).toBe(initialStores);
  expect(await page.evaluate(() => window.rolePreviewStorageWrites)).toEqual([]);
  expect(roleRequests).toEqual([]);
  for (const body of localActivity) {
    expect(Object.keys(body)).toEqual(['events']);
    for (const event of body.events) {
      expect(Object.keys(event).sort()).toEqual(['action', 'event_id', 'resource']);
      expect(['page_view', 'created', 'updated']).toContain(event.action);
      expect(event.resource).toBe('roles_permissions');
    }
  }
  await page.reload();
  await expect(page.getByTestId('text-role-count')).toHaveText('3');
  await expect(page.getByTestId('text-active-role')).toHaveText('Demo Coordinator');
  await count(page, total);
  await expect(page.getByText('Fictional Reviewer')).toHaveCount(0);
});

test('individual, row, column and module aggregates respect unsupported actions and search scopes', async ({ page }) => {
  await open(page);
  await page.getByTestId('button-clear-role').click();
  await count(page, 0);
  await page.getByTestId('checkbox-perm-zones-view').check();
  for (const id of ['checkbox-row-zones', 'checkbox-column-view', 'checkbox-module-masters', 'checkbox-module-current']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'mixed');
    expect(await page.getByTestId(id).evaluate((el) => el.indeterminate)).toBe(true);
  }
  await page.getByTestId('checkbox-row-zones').check();
  await count(page, 4);
  await expect(page.getByTestId('checkbox-row-zones')).toBeChecked();
  await page.getByTestId('checkbox-row-zones').uncheck();
  await count(page, 0);
  await page.getByTestId('checkbox-perm-patients-view').check();
  await page.getByTestId('input-search-permissions').fill('Zone Master');
  await expect(page.locator('.rp-table tbody tr')).toHaveCount(1);
  await count(page, 1);
  await page.getByTestId('checkbox-column-view').check();
  await count(page, 2);
  await page.getByTestId('checkbox-column-view').uncheck();
  await count(page, 1);
  await page.getByTestId('checkbox-module-current').check();
  const mastersTotal = permissionKeys(MODULES.find((m) => m.id === 'masters').rows).length;
  await count(page, mastersTotal);
  await page.getByTestId('input-search-permissions').fill('does-not-exist');
  await expect(page.getByTestId('status-no-rows')).toContainText('Selections are unchanged');
  await count(page, mastersTotal);
  await page.getByTestId('button-all-role').click();
  await count(page, total);
  await page.getByTestId('button-clear-role').click();
  await count(page, 0);
  await page.getByTestId('input-search-permissions').fill('');
  await expect(page.getByTestId('checkbox-perm-patients-view')).not.toBeChecked();
  await expect(page.getByTestId('text-na-patients-delete')).toBeVisible();
  await expect(page.getByTestId('checkbox-perm-patients-delete')).toHaveCount(0);
  await page.getByTestId('checkbox-column-delete').check();
  await count(page, 3);
  await page.getByTestId('button-module-dashboard').click();
  await expect(page.locator('.rp-table tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('checkbox-column-edit')).toBeDisabled();
  await expect(page.getByTestId('checkbox-column-delete')).toBeDisabled();
  await expect(page.getByTestId('checkbox-column-download')).toBeDisabled();
  await page.getByTestId('checkbox-module-dashboard').check();
  await count(page, 4);
  await expect(page.getByTestId('checkbox-module-current')).toBeChecked();
  await page.getByTestId('checkbox-perm-dashboard-view').focus();
  await page.keyboard.press('Space');
  await count(page, 3);
});

test('sidebar placement, search, active group and collapsed access preserve the staff link', async ({ page }) => {
  await open(page);
  const links = page.locator('#admin-user-management-subnav a');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAccessibleName('Staff Management');
  await expect(links.nth(1)).toHaveAccessibleName('Roles & Permissions');
  await expect(page.getByTestId('link-admin-roles-permissions')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('button-toggle-user-management')).toHaveClass(/admin-nav__item--active/);
  await page.getByTestId('input-search-navigation').fill('permissions');
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeVisible();
  await expect(page.getByTestId('link-admin-staff')).toHaveCount(0);
  await page.getByTestId('button-clear-navigation-search').click();
  await page.getByTestId('button-toggle-sidebar').click();
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeHidden();
  await page.getByTestId('button-toggle-user-management').click();
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeVisible();
  await page.getByTestId('button-toggle-sidebar').click();
  await page.getByTestId('button-search-navigation').click();
  await page.getByTestId('input-search-navigation').fill('roles');
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeVisible();
});

for (const [width, theme, appearance] of [[1440, 'classic', 'light'], [1440, 'modern', 'dark'], [375, 'classic', 'light'], [375, 'modern', 'dark']]) {
  test(`layout and mobile navigation at ${width}px in ${theme} ${appearance}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    // Theme fixture uses the same preference setter as Settings; no auth bypass.
    await page.evaluate(async ({ theme, appearance }) => {
      const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
      setAdminPreference('theme', theme);
      setAdminPreference('appearance', appearance);
    }, { theme, appearance });
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const left = await page.locator('.rp-roles').boundingBox();
    const work = await page.locator('.rp-work').boundingBox();
    // Capture the page before opening the animated mobile drawer.
    await page.screenshot({ path: `test-results/roles-${width}-${theme}-${appearance}.png`, fullPage: true });
    if (width < 900) {
      expect(work.y).toBeGreaterThan(left.y + left.height);
      expect(await page.locator('.rp-scroll').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await page.getByTestId('button-open-navigation').click();
      await page.getByTestId('input-search-navigation').fill('permissions');
      await page.getByTestId('link-admin-roles-permissions').click();
      await expect(page.getByTestId('button-open-navigation')).toHaveAttribute('aria-expanded', 'false');
    } else expect(work.x).toBeGreaterThan(left.x + left.width);
  });
}
