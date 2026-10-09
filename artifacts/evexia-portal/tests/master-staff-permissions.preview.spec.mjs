import { test, expect } from '@playwright/test';
import { MASTER_CATALOGUE } from '../src/auth/capabilities.js';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');

async function settledStaff(page, path) {
  const paths = Array.isArray(path) ? path : [path];
  const escaped = paths.map(value => `${base()}${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  await expect(page).toHaveURL(new RegExp(`^(?:${escaped.join('|')})$`));
  // Full document navigation destroys the Web Lock owner. Never navigate again
  // while restoration is rotating the shared refresh cookie: a delayed response
  // from the destroyed document can turn the next restore into a replay.
  await expect.poll(() => page.evaluate(async () => {
    const { getSession } = await import('/src/auth/adminSession.js');
    const state = getSession();
    return state.status === 'authenticated' && state.user?.identity_kind === 'staff';
  })).toBe(true);
}

for (const master of MASTER_CATALOGUE) test(`${master.key}: single-action staff roles mount only their own master and applicable controls`, async ({ page, browser }, info) => {
  test.setTimeout(300000);
  await page.goto(`${base()}/admin/roles-permissions`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-add-role')).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    const { MASTER_CATALOGUE } = await import('/src/auth/capabilities.js');
    const suffix = crypto.randomUUID().slice(0, 8);
    const role = await roles.createRole({ name: `Matrix ${suffix}`, description: 'Synthetic isolated matrix' });
    const made = await staff.createStaff({ name: `Matrix ${suffix}`, email: `matrix-${suffix}@example.com`,
      phone: '9876543210', dialCountry: 'IN', status: 'active', role: 'Staff', designation: 'Executive', dateOfJoining: '2026-01-05' });
    await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: true });
    return { roleId: role.id, staffId: made.record.id, userId: made.record.userId, password: made.initial_password, masters: MASTER_CATALOGUE };
  });
  const context = await browser.newContext();
  const clerk = await context.newPage();
  let primaryFailure;
  try {
    await clerk.goto(`${base()}/admin`);
    await clerk.getByLabel('Email or username').fill(fixture.userId);
    await clerk.getByLabel('Password', { exact: true }).fill(fixture.password);
    await clerk.getByTestId('button-submit-login').click();
    await expect(clerk.getByTestId('status-no-workspace-access')).toBeVisible();
    await settledStaff(clerk, '/admin');
      for (const action of ['add', 'edit', 'delete', 'import', 'export']) {
        await test.step(`${master.key}.${action}`, async () => {
        await page.evaluate(async ({ id, grant }) => {
          const roles = await import('/src/services/rolePermissions.js');
          const role = await roles.getRole(id);
          await roles.setRolePermissions(id, [grant], role.version);
        }, { id: fixture.roleId, grant: `${master.key}.${action}` });
        const route = `/admin/masters/${master.path}`;
        await clerk.goto(`${base()}${route}`);
        await settledStaff(clerk, route);
        await expect(clerk.locator('.admin-error')).toHaveCount(0);
        // Use capability-filtered navigation; unrelated directories and protected menus never appear.
        for (const other of fixture.masters) {
          const links = clerk.locator(`#admin-navigation a[href="${base()}${'/admin/masters/' + other.path}"], #admin-navigation a[href="/admin/masters/${other.path}"]`);
          if (other.key !== master.key) await expect(links).toHaveCount(0);
        }
        await expect(clerk.getByTestId('link-admin-staff')).toHaveCount(0);
        await expect(clerk.getByTestId('link-admin-roles-permissions')).toHaveCount(0);
        // Older HQ/Category controls have accessible names, not data-testid IDs.
        const add = clerk.getByRole('button', { name: /^Add /i });
        const exporting = clerk.getByRole('button', { name: /^(Export data|Exporting|Preparing export)/i });
        const importing = clerk.getByRole('button', { name: /^Import data$/i });
        await expect(add).toHaveCount(action === 'add' ? 1 : 0);
        await expect(exporting).toHaveCount(action === 'export' ? 1 : 0);
        await expect(importing).toHaveCount(action === 'import' ? 1 : 0);
        if (action !== 'add') {
          await clerk.goto(`${base()}${route}/new`);
          await settledStaff(clerk, ['/admin', route]);
          await expect(clerk.getByRole('button', { name: /^Save /i })).toHaveCount(0);
        } else {
          await add.click();
          if (['zone', 'courier'].includes(master.key)) await expect(clerk.getByRole('dialog')).toBeVisible();
          else await expect(clerk).toHaveURL(new RegExp(`${route}/new$`));
          await expect(clerk.getByRole('button', { name: /Save|Add/i }).first()).toBeVisible();
          await expect(clerk.locator('.admin-error')).toHaveCount(0);
        }
        if (action === 'import') {
          await clerk.goto(`${base()}${route}`);
          await settledStaff(clerk, route);
          await clerk.getByRole('button', { name: /^Import data$/i }).click();
          await expect(clerk.locator('.excel-import__tab')).toHaveCount(1);
          await expect(clerk.locator('input[type="file"]')).toBeAttached();
        } else {
          await clerk.goto(`${base()}/admin/masters/import/${master.import}`);
          await settledStaff(clerk, ['/admin', route]);
          await expect(clerk.locator('input[type="file"]')).toHaveCount(0);
        }
        if (master.key === 'mr') await expect(clerk.locator('[data-testid^="button-reset-mr-"]')).toHaveCount(0);
        });
      }
    await expect(clerk.getByRole('heading', { name: new RegExp(master.label) }).first()).toBeVisible();
    await clerk.screenshot({ path: info.outputPath('single-action-master.png') });
  } catch (error) {
    primaryFailure = error;
    await clerk.screenshot({ path: info.outputPath('failed-clerk.png') }).catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    try { await page.evaluate(async ({ staffId, roleId }) => {
      const staff = await import('/src/services/staff.js');
      const roles = await import('/src/services/rolePermissions.js');
      const record = await staff.getStaff(staffId);
      await staff.setStaffAccess(record, { customRoleId: null, loginEnabled: false });
      const role = await roles.getRole(roleId);
      await roles.deleteRole(role.id, role.version);
    }, fixture); } catch (error) { if (!primaryFailure) throw error; }
  }
});
