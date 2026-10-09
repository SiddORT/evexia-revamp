import { test, expect } from '@playwright/test';
import { readFile as readFileBuffer } from 'node:fs/promises';
import { expectCurrentZoneHeader } from './zone-header.assertions.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
test.setTimeout(120000);
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const KEYS = ['add', 'edit', 'delete', 'export', 'import'];

async function login(page, identifier, password, path) {
  await page.goto(`${base()}${path}`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or username').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('button-submit-login').click();
}

// Provision through the same-origin service layer as the Super Admin.
async function provision(page, suffix) {
  return page.evaluate(async (suffix) => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    const role = await roles.createRole({ name: `Zone clerk ${suffix}`, description: 'permission spec' });
    const made = await staff.createStaff({ name: `Clerk ${suffix}`, phone: '9876543210', dialCountry: 'IN', email: `clerk-${suffix}@example.com`, status: 'active', role: 'Staff', designation: 'Executive', dateOfJoining: '2026-01-05' });
    return { roleId: role.id, staffId: made.record.id, userId: made.record.userId, password: made.initial_password };
  }, suffix);
}

test('role matrix: All/None, saved count, dirty guard, metadata edit keeps grants', async ({ page }, testInfo) => {
  const s = `${Date.now()}`;
  await login(page, 'crm-admin@allergyevexia.in', process.env.EVEXIA_TEST_ADMIN_PASSWORD, '/admin/roles-permissions');
  await expect(page.getByTestId('button-add-role')).toBeEnabled();
  const ids = await provision(page, s);
  await page.getByTestId('button-refresh-roles').click();
  await page.getByTestId(`button-role-${ids.roleId}`).click();
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  for (const key of KEYS) await expect(page.getByTestId(`checkbox-permission-zone.${key}`)).not.toBeChecked();
  await expect(page.getByTestId('text-saved-permission-count')).toContainText('0 of 40');
  await page.getByTestId('button-permissions-all').click();
  for (const key of KEYS) await expect(page.getByTestId(`checkbox-permission-zone.${key}`)).toBeChecked();
  await page.getByTestId('button-permissions-none').click();
  await page.getByTestId('checkbox-permission-zone.import').check();
  await expect(page.getByTestId('text-draft-permission-count')).toContainText('1 of 40');
  // Dirty switching guard: keep editing preserves the draft.
  await page.getByTestId('link-admin-staff').click();
  await expect(page.getByTestId('button-keep-editing-permissions')).toBeVisible();
  await page.getByTestId('button-keep-editing-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
  await page.getByTestId('button-save-permissions').click();
  await expect(page.getByTestId('status-roles-notice')).toContainText('1 permission');
  await expect(page.getByTestId('text-saved-permission-count')).toContainText('1 of 40');
  await page.reload();
  await expect(page.getByTestId(`button-role-${ids.roleId}`)).toContainText('1 permission');
  await page.getByTestId(`button-role-${ids.roleId}`).click();
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
  await page.getByRole('tab', { name: 'Roles', exact: true }).click();
  await page.getByTestId('button-edit-role').click();
  await page.getByTestId('input-role-description').fill('renamed only');
  await page.getByTestId('button-save-role').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await expect(page.getByTestId('checkbox-permission-zone.import')).toBeChecked();
  await expect(page.getByTestId('checkbox-permission-zone.add')).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('protected-role-permission-matrix.png'), fullPage: true });
});

test('staff access: explicit assignment, restricted workspace, import without add', async ({ page, browser }, testInfo) => {
  const s = `${Date.now()}`;
  await login(page, 'crm-admin@allergyevexia.in', process.env.EVEXIA_TEST_ADMIN_PASSWORD, '/admin/staff');
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
  const ids = await provision(page, s);
  await page.getByTestId('button-refresh-staff').click();
  // Nothing is assigned or enabled automatically.
  await expect(page.getByTestId(`text-staff-access-${ids.staffId}`)).toHaveText('No role · login disabled');
  await page.evaluate(async ({ roleId }) => {
    const roles = await import('/src/services/rolePermissions.js');
    const role = await roles.getRole(roleId);
    await roles.setRolePermissions(roleId, ['zone.import', 'zone.export'], role.version);
  }, ids);
  await page.getByTestId(`button-access-staff-${ids.staffId}`).click();
  await page.getByTestId(`radio-staff-access-${ids.roleId}`).check();
  await page.getByTestId('checkbox-staff-workspace-login').check();
  await page.getByTestId('button-save-staff-access').click();
  await expect(page.getByTestId(`text-staff-access-${ids.staffId}`)).toHaveText('Role assigned · login enabled');
  await page.screenshot({ path: testInfo.outputPath('staff-access-assigned-role.png'), fullPage: true });

  const ctx = await browser.newContext();
  const staff = await ctx.newPage();
  await login(staff, ids.userId, ids.password, '/admin');
  await expect(staff).toHaveURL(/\/admin\/masters\/zones$/);
  await expect(staff.getByTestId('button-import-zones')).toBeVisible();
  await expect(staff.getByTestId('button-export-zones')).toBeVisible();
  await expect(staff.getByTestId('text-zone-count')).toBeVisible();
  await expectCurrentZoneHeader(staff);
  await staff.setViewportSize({ width: 390, height: 844 });
  await expectCurrentZoneHeader(staff);
  for (const hidden of ['button-add-zone', 'button-zone-trash', 'button-zone-current', 'link-admin-settings', 'link-admin-staff', 'link-admin-roles-permissions', 'link-admin-purchase-orders']) await expect(staff.getByTestId(hidden)).toHaveCount(0);
  await staff.screenshot({ path: testInfo.outputPath('restricted-zone-import-export.png'), fullPage: true });
  for (const path of ['/admin/staff', '/admin/settings', '/admin/masters/mrs', '/admin/inventory/purchase-orders', '/admin/activity-logs']) {
    await staff.goto(`${base()}${path}`);
    await expect(staff).toHaveURL(new RegExp('/admin/masters/zones$'));
  }
  await staff.goto(`${base()}/admin/masters/import/zone`);
  await expect(staff.getByRole('heading', { name: /Import Zone data/i })).toBeVisible();
  await ctx.close();

  // Explicit None: login stays enabled, but Zone is denied with a clear screen.
  await page.getByTestId(`button-access-staff-${ids.staffId}`).click();
  await page.getByTestId('radio-staff-access-none').check();
  await expect(page.getByTestId('checkbox-staff-workspace-login')).toBeChecked();
  await page.getByTestId('button-save-staff-access').click();
  const again = await browser.newContext();
  const denied = await again.newPage();
  await login(denied, ids.userId, ids.password, '/admin');
  await expect(denied.getByTestId('status-no-workspace-access')).toBeVisible();
  await denied.goto(`${base()}/admin/masters/zones`);
  await expect(denied.getByTestId('status-no-workspace-access')).toBeVisible();
  await expect(denied).toHaveURL(/\/admin$/);
  await denied.screenshot({ path: testInfo.outputPath('restricted-zone-denied.png'), fullPage: true });
  await again.close();
});

// ---- Action-level coverage -------------------------------------------------
const PW = () => process.env.EVEXIA_TEST_ADMIN_PASSWORD;
const ADMIN = 'crm-admin@allergyevexia.in';

async function adminPage(browser, path = '/admin/staff') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, ADMIN, PW(), path);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return { context, page };
}

// Creates a role with the exact grants plus a staff member who may sign in.
async function provisionWith(admin, grants, { login: enabled = true } = {}) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return admin.evaluate(async ({ suffix, grants, enabled }) => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    let role = await roles.createRole({ name: `Spec role ${suffix}`, description: 'synthetic' });
    if (grants.length) role = await roles.setRolePermissions(role.id, grants, role.version);
    const made = await staff.createStaff({ name: `Spec ${suffix}`, phone: '9876543210', dialCountry: 'IN', email: `spec-${suffix}@example.com`, status: 'active', role: 'Staff', designation: 'Executive', dateOfJoining: '2026-01-05' });
    const access = await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: enabled });
    return { roleId: role.id, staffId: made.record.id, userId: made.record.userId, password: made.initial_password, version: access.version };
  }, { suffix, grants, enabled });
}
const setAccess = (admin, ids, customRoleId, loginEnabled) => admin.evaluate(async ({ staffId, customRoleId, loginEnabled }) => {
  const staff = await import('/src/services/staff.js');
  const current = await staff.getStaff(staffId);
  await staff.setStaffAccess(current, { customRoleId, loginEnabled });
}, { staffId: ids.staffId, customRoleId, loginEnabled });

async function staffPage(browser, ids, path = '/admin/masters/zones') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, ids.userId, ids.password, path);
  // Wait for verified, rendered content, not just the URL.
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  return { context, page };
}
// Captures the live bearer token from a genuine zone list request.
async function bearer(page) {
  const request = page.waitForRequest((r) => /\/api\/v1\/admin\/zones(\?|$)/.test(r.url()) && Boolean(r.headers().authorization));
  await page.getByRole('button', { name: 'Refresh records' }).click();
  return (await request).headers().authorization;
}
const api = (page, token, method, path, data) => page.request.fetch(`${base()}/api/v1${path}`, { method, headers: { authorization: token, 'content-type': 'application/json' }, data });

test('staff with Add+Edit+Delete performs manual create, edit, status and soft delete; trash is refused', async ({ browser }) => {
  const { context, page: admin } = await adminPage(browser);
  const ids = await provisionWith(admin, ['zone.add', 'zone.edit', 'zone.delete']);
  const { context: sc, page } = await staffPage(browser, ids);
  const name = `Staff zone ${Date.now()}`;
  await expect(page.getByTestId('button-add-zone')).toBeVisible();
  await expect(page.getByTestId('text-zone-count')).toBeVisible();
  await expectCurrentZoneHeader(page);
  for (const hidden of ['button-import-zones', 'button-export-zones', 'button-zone-trash', 'button-zone-current']) await expect(page.getByTestId(hidden)).toHaveCount(0);
  await page.getByTestId('button-add-zone').click();
  await page.getByLabel('Zone name *').fill(name);
  const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/zones' && r.request().method() === 'POST');
  await page.getByTestId('button-save-zone').click();
  const record = await (await created).json();
  await expect(page.getByTestId(`text-zone-name-${record.id}`)).toHaveText(name);
  await page.getByTestId(`button-edit-zone-${record.id}`).click();
  await page.getByLabel('Zone name *').fill(`${name} edited`);
  await page.getByTestId('button-save-zone').click();
  await expect(page.getByTestId(`text-zone-name-${record.id}`)).toHaveText(`${name} edited`);
  await page.getByTestId(`button-toggle-zone-${record.id}`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId(`button-toggle-zone-${record.id}`)).toHaveAccessibleName(/^Activate/);
  const token = await bearer(page);
  // Direct API: trash, restore and global histories stay Super Admin only.
  expect((await api(page, token, 'GET', '/admin/zones/trash')).status()).toBe(403);
  expect((await api(page, token, 'GET', '/admin/reporting/downloads')).status()).toBe(403);
  expect((await api(page, token, 'GET', '/admin/reporting/sessions')).status()).toBe(403);
  // Export and import are not granted.
  expect((await api(page, token, 'GET', '/admin/zones/export?format=csv')).status()).toBe(403);
  expect((await api(page, token, 'POST', '/admin/zones/import/review?filename=a.csv')).status()).toBe(403);
  await page.getByTestId(`button-delete-zone-${record.id}`).click();
  await expect(page.getByRole('dialog')).not.toContainText('Deleted zones');
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByTestId(`text-zone-name-${record.id}`)).toHaveCount(0);
  expect((await api(page, token, 'POST', `/admin/zones/${record.id}/restore`, { expected_version: 99 })).status()).toBe(403);
  // Soft deletion is visible to the Super Admin in trash.
  const trashed = await admin.evaluate(async (id) => (await (await import('/src/services/serverZones.js')).listDeletedZones({ query: '', status: 'all', limit: 100, offset: 0 })).items.some((z) => z.id === id), record.id);
  expect(trashed).toBe(true);
  await sc.close(); await context.close();
});

test('staff with Export only exports CSV and XLSX; sample ledger needs Import', async ({ browser }) => {
  const { context, page: admin } = await adminPage(browser);
  const ids = await provisionWith(admin, ['zone.export']);
  const { context: sc, page } = await staffPage(browser, ids);
  for (const hidden of ['button-add-zone', 'button-import-zones']) await expect(page.getByTestId(hidden)).toHaveCount(0);
  await expect(page.locator('[data-testid^="button-edit-zone-"], [data-testid^="button-delete-zone-"]')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  const csv = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  expect((await csv).suggestedFilename()).toBe('evexia-zone-master.csv');
  const xlsx = page.waitForEvent('download');
  await page.getByTestId('button-export-zones').click();
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)', exact: true }).click();
  expect((await readFileBuffer(await (await xlsx).path())).subarray(0, 2).toString()).toBe('PK');
  const token = await bearer(page);
  await page.goto(`${base()}/admin/masters/import/zone`);
  await expect(page).toHaveURL(/\/admin\/masters\/zones$/);
  await expect(page.getByTestId('button-export-zones')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const body = { initiation_id: '00000000-0000-4000-8000-0000000000aa', source: 'zone', kind: 'sample', format: 'CSV' };
  expect((await api(page, token, 'POST', '/admin/reporting/downloads/initiate', body)).status()).toBe(403);
  await sc.close(); await context.close();
});

test('staff with Import only downloads samples, reviews and commits without Add', async ({ browser }) => {
  const { context, page: admin } = await adminPage(browser);
  const ids = await provisionWith(admin, ['zone.import']);
  const { context: sc, page } = await staffPage(browser, ids);
  await expect(page.getByTestId('button-add-zone')).toHaveCount(0);
  await expect(page.getByTestId('button-export-zones')).toHaveCount(0);
  await page.getByTestId('button-import-zones').click();
  const sample = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel sample' }).click();
  await sample;
  const name = `Import only ${Date.now()}`;
  await page.getByLabel('Zone CSV or Excel file').setInputFiles({ name: 'staff.csv', mimeType: 'text/csv', buffer: Buffer.from(`Zone Name,Status\n${name},active`) });
  await page.getByRole('button', { name: 'Upload & review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm import of 1 zones' }).click();
  await expect(page.getByRole('status')).toContainText('1 zones imported');
  // The sample download is accepted into the Super Admin download ledger.
  const actorId = await page.evaluate(async () => {
    const { getSession } = await import('/src/auth/adminSession.js');
    return getSession().user.id;
  });
  const logged = await admin.evaluate(async (actorId) => {
    const { reportingRequest } = await import('/src/auth/adminSession.js');
    const data = await reportingRequest('downloads', { user_id: actorId, limit: 25, offset: 0 });
    return (data.items || []).some((row) => row.module === 'Zone Master'
      && row.label === 'Zone Master sample' && row.format === 'XLSX'
      && row.provenance === 'browser_reported' && row.user?.id === actorId);
  }, actorId);
  expect(logged).toBe(true);
  await sc.close(); await context.close();
});

test('revoking the role or login while staff is signed in takes effect on verification', async ({ browser }) => {
  const { context, page: admin } = await adminPage(browser);
  const ids = await provisionWith(admin, ['zone.add', 'zone.export']);
  const { context: sc, page } = await staffPage(browser, ids);
  await expect(page.getByTestId('button-add-zone')).toBeVisible();
  await setAccess(admin, ids, null, true);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(false));
  await expect(page.getByTestId('status-no-workspace-access')).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId('button-add-zone')).toHaveCount(0);
  await setAccess(admin, ids, ids.roleId, false);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(false)).catch(() => null);
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByTestId('button-submit-login')).toBeVisible();
  await sc.close(); await context.close();
});

// ---- Role draft: stale, unknown outcome, navigation -----------------------
async function openRole(browser) {
  const { context, page } = await adminPage(browser, '/admin/roles-permissions');
  const ids = await provisionWith(page, []);
  await page.getByTestId('button-refresh-roles').click();
  await page.getByTestId(`button-role-${ids.roleId}`).click();
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  return { context, page, ids };
}

test('stale role: external change forces explicit adopt or discard, even when grants now match', async ({ browser }) => {
  const { context, page, ids } = await openRole(browser);
  await page.getByTestId('checkbox-permission-zone.add').check();
  await page.evaluate(async (id) => {
    const roles = await import('/src/services/rolePermissions.js');
    const role = await roles.getRole(id);
    await roles.setRolePermissions(id, ['zone.add'], role.version);
  }, ids.roleId);
  await page.getByTestId('button-refresh-roles').click();
  await expect(page.getByTestId('status-permissions-stale')).toBeVisible();
  await expect(page.getByTestId('button-save-permissions')).toBeDisabled();
  await page.getByTestId('button-adopt-permissions').click();
  await expect(page.getByTestId('status-permissions-stale')).toHaveCount(0);
  await page.getByTestId('checkbox-permission-zone.edit').check();
  await page.getByTestId('button-save-permissions').click();
  await expect(page.getByTestId('text-saved-permission-count')).toContainText('2 of 40');
  await context.close();
});

test('unknown save outcome blocks saving until explicit refresh', async ({ browser }) => {
  const { context, page, ids } = await openRole(browser);
  await page.getByTestId('checkbox-permission-zone.export').check();
  await page.route('**/api/v1/admin/roles/*/permissions', (route) => route.abort('failed'));
  await page.getByTestId('button-save-permissions').click();
  await expect(page.getByTestId('status-permissions-error')).toContainText('Result unknown');
  await expect(page.getByTestId('button-save-permissions')).toBeDisabled();
  await page.unroute('**/api/v1/admin/roles/*/permissions');
  await page.getByTestId('button-refresh-permission-roles').click();
  await expect(page.getByTestId('status-permissions-error')).toHaveCount(0);
  await expect(page.getByTestId(`button-role-${ids.roleId}`)).toBeVisible();
  await context.close();
});

test('committed but lost permission result reconciles across tabs; assigned deletion is explained', async ({ browser }) => {
  const { context, page, ids } = await openRole(browser);
  await page.getByTestId('checkbox-permission-zone.export').check();
  let writes = 0;
  await page.route('**/api/v1/admin/roles/*/permissions', async (route) => {
    writes++;
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByTestId('button-save-permissions').click();
  await expect(page.getByTestId('status-permissions-error')).toContainText('Result unknown');
  await page.getByTestId('tab-roles').click();
  await page.getByTestId('button-edit-role').click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Unsaved permission changes');
  await page.getByTestId('button-keep-editing-permissions').click();
  await page.getByTestId('tab-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.export')).toBeChecked();
  await page.unroute('**/api/v1/admin/roles/*/permissions');
  await page.getByTestId('button-refresh-permission-roles').click();
  await expect(page.getByTestId('status-roles-notice')).toContainText('could not be confirmed as yours');
  await expect(page.getByTestId('text-saved-permission-count')).toContainText('1 of 40');
  expect(writes).toBe(1);
  await page.getByTestId('tab-roles').click();
  await page.getByTestId('button-delete-role').click();
  await page.getByTestId('button-confirm-delete-role').click();
  await expect(page.getByTestId('text-role-error')).toContainText('assigned to staff');
  await page.getByTestId('button-cancel-role').click();
  await expect(page.getByTestId(`button-role-${ids.roleId}`)).toContainText('1 permission');
  await context.close();
});

test('dirty draft guards profile menu, log out and browser Back; saving blocks switching', async ({ browser }) => {
  const { context, page } = await openRole(browser);
  await page.getByTestId('checkbox-permission-zone.delete').check();
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-settings').click();
  await expect(page.getByTestId('button-keep-editing-permissions')).toBeVisible();
  await page.getByTestId('button-keep-editing-permissions').click();
  await expect(page).toHaveURL(/roles-permissions$/);
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page.getByTestId('button-discard-permissions-continue')).toBeVisible();
  await page.getByTestId('button-keep-editing-permissions').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('button-keep-editing-permissions')).toBeVisible();
  await expect(page).toHaveURL(/roles-permissions$/);
  await page.getByTestId('button-keep-editing-permissions').click();
  await expect(page.getByTestId('checkbox-permission-zone.delete')).toBeChecked();
  // Slow the save so the in-flight state can be observed.
  await page.route('**/api/v1/admin/roles/*/permissions', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await page.getByTestId('button-save-permissions').click();
  await expect(page.getByTestId('button-cancel-permissions')).toBeDisabled();
  await expect(page.locator('[data-testid^="button-role-"]').first()).toBeDisabled();
  await expect(page.getByTestId('text-saved-permission-count')).toContainText('1 of 40');
  await context.close();
});
