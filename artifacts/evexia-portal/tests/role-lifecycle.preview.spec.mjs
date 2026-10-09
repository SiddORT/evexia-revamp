import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
test.setTimeout(90000);

test('assigned role verification separates outages from tombstones and requires explicit remediation', async ({ page }, info) => {
  if (!process.env.EVEXIA_PREVIEW_BASE_URL) throw Error('Use isolated authenticated harness.');
  await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/staff`);
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-add-staff')).toBeEnabled();
  const key = randomUUID().slice(0, 8);
  const fixture = await page.evaluate(async (key) => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    const designations = await import('/src/services/serverDesignations.js');
    const designation = await designations.createDesignation({ name: `Role lifecycle ${key}`, shortName: 'RL', status: 'active' });
    const role = await roles.createRole({ name: `Retained role ${key}`, description: 'Synthetic' });
    const made = await staff.createStaff({ name: `Lifecycle ${key}`, email: `${key}@example.com`, phone: '9876543210',
      dialCountry: 'IN', role: 'Staff', designation_id: designation.id, dateOfJoining: '2026-01-01', status: 'active' });
    const record = await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: false });
    return { role, record };
  }, key);
  await page.reload();
  const open = async () => {
    await page.getByTestId(`button-access-staff-${fixture.record.id}`).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  };
  const path = `**/api/v1/admin/roles/${fixture.role.id}`;
  await page.route(path, (route) => route.abort('failed'));
  await open();
  await expect(page.getByText('This does not prove the role was deleted.', { exact: false })).toBeVisible();
  await page.getByTestId('checkbox-staff-workspace-login').check();
  await expect(page.getByTestId('button-save-staff-access')).toBeDisabled();
  await page.unroute(path);
  await page.getByRole('button', { name: 'Retry role verification' }).click();
  await expect(page.getByTestId('button-save-staff-access')).toBeEnabled();
  await page.getByTestId('button-cancel-staff-access').click();
  // Defensive response validation: a stale/misbehaving detail service must not
  // hydrate a retained tombstone as a selectable role, even when the live list
  // still contains the ID. This intercept is not a real database deletion.
  await page.route(path, (route) => route.fulfill({ json: {
    ...fixture.role, deleted_at: fixture.role.updated_at, deleted_by: fixture.role.updated_by,
  } }));
  await open();
  await expect(page.getByText('This assigned role is unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByTestId(`radio-staff-access-${fixture.role.id}`)).toBeDisabled();
  await page.getByTestId('checkbox-staff-workspace-login').check();
  await expect(page.getByTestId('button-save-staff-access')).toBeDisabled();
  await page.getByTestId('radio-staff-access-none').check();
  await expect(page.getByTestId('button-save-staff-access')).toBeEnabled();
  await page.getByTestId('button-save-staff-access').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute(path);
  const deleted = await page.evaluate(async ({ role, record }) => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    const current = await staff.getStaff(record.id);
    if (current.custom_role_id !== null) throw Error('Unassignment not persisted.');
    return roles.deleteRole(role.id, role.version);
  }, fixture);
  expect(deleted.deleted_by).toBe(fixture.role.created_by);
  expect(deleted.deleted_at).toBe(deleted.updated_at);
  expect(deleted.version).toBe(fixture.role.version + 1);
  await page.screenshot({ path: info.outputPath('staff-role-remediation.png'), fullPage: true });
});
