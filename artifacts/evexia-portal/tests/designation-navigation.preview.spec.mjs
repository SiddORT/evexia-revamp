import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const list = '/admin/masters/designations';
const imports = '/admin/masters/import/designation';

async function login(page, identifier = 'crm-admin@allergyevexia.in', password = process.env.EVEXIA_TEST_ADMIN_PASSWORD) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}

async function section(page, expanded = true) {
  await expect(page.getByTestId('button-toggle-user-management')).toHaveClass(/admin-nav__item--active/);
  await expect(page.getByTestId('button-toggle-user-management')).toHaveAttribute('aria-expanded', String(expanded));
  await expect(page.getByTestId('button-toggle-masters')).not.toHaveClass(/admin-nav__item--active/);
  await expect(page.getByTestId('button-toggle-masters')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.admin-page-head__eyebrow').first()).toContainText('User Management');
  if (expanded) {
    await expect(page.locator('#admin-user-management-subnav [data-testid="link-admin-designations"]')).toBeVisible();
    await expect(page.getByTestId('link-admin-designations')).toHaveCount(1);
    await expect(page.getByTestId('link-admin-designations')).toHaveClass(/admin-nav__item--active/);
    await expect(page.getByTestId('link-admin-designations')).toHaveAttribute('href', list);
  }
}

// Enter controls with real Tab events rather than substituting scripted focus.
async function tabTo(page, target) {
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Navigation control was not keyboard reachable');
}

test('designation direct list/add/edit/import routes belong to User Management; choices and URLs stay intact', async ({ page }, testInfo) => {
  await login(page);
  const row = await page.evaluate(async () => (await import('/src/services/serverDesignations.js')).createDesignation({
    name: 'Navigation designation', shortName: 'NAV', level: 7, status: 'active',
  }));
  for (const path of [list, `${list}/new`, `${list}/${row.id}`, imports]) {
    await page.goto(`${base()}${path}`);
    await section(page);
    if (path === list) await expect(page.getByTestId('link-admin-designations')).toHaveAttribute('aria-current', 'page');
    else await expect(page.getByTestId('link-admin-designations')).not.toHaveAttribute('aria-current', 'page');
    if (path === `${list}/${row.id}`) await expect(page.getByTestId('input-designation-name')).toHaveValue(row.name);
  }
  await page.screenshot({ path: testInfo.outputPath('designation-user-management-import.png'), fullPage: true });
  // Existing import tabs still navigate between sections at unchanged URLs.
  await page.getByRole('button', { name: 'Zone Master', exact: true }).click();
  await expect(page.getByTestId('button-toggle-masters')).toHaveClass(/admin-nav__item--active/);
  await page.getByRole('button', { name: 'Designation Master', exact: true }).click();
  await section(page);
  await page.getByRole('button', { name: 'Back to Designation Master', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  await section(page);
  await expect(page.locator('#admin-user-management-subnav a')).toHaveText(['Staff Management', 'Roles & Permissions', 'Designation Master']);
  await page.getByTestId('link-admin-staff').click();
  await page.getByTestId('button-add-staff').click();
  await expect(page.getByTestId('select-staff-designation').locator('option', { hasText: row.name })).toHaveCount(1);
  await page.goto(`${base()}/admin/masters`);
  await expect(page.getByTestId('link-master-designations')).toHaveCount(0);
  await expect(page.locator('.admin-master-link', { hasText: 'Designation Master' })).toHaveCount(0);
});

test('designation and section searches expose the correct parent and preserve other results and empty state', async ({ page }) => {
  await login(page);
  await page.goto(`${base()}${list}`);
  const search = page.getByTestId('input-search-navigation');
  for (const query of ['designation', 'Designation Master', 'User Management']) {
    await search.fill(query);
    await expect(page.locator('#admin-user-management-subnav [data-testid="link-admin-designations"]')).toBeVisible();
    await expect(page.getByTestId('button-toggle-user-management')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('button-toggle-masters')).toHaveCount(0);
    await expect(page.getByTestId('status-navigation-empty')).toHaveCount(0);
  }
  await search.fill('staff');
  await expect(page.getByTestId('link-admin-staff')).toBeVisible();
  await expect(page.getByTestId('link-admin-designations')).toHaveCount(0);
  await search.fill('roles');
  await expect(page.getByTestId('link-admin-roles-permissions')).toBeVisible();
  for (const [query, result] of [['all masters', 'link-admin-masters'], ['zone', 'link-admin-zones'], ['inventory', 'link-admin-purchase-orders']]) {
    await search.fill(query);
    await expect(page.getByTestId(result)).toBeVisible();
    await expect(page.getByTestId('button-toggle-user-management')).toHaveCount(0);
  }
  await search.fill('no-such-navigation-result');
  await expect(page.getByTestId('status-navigation-empty')).toHaveText('No navigation results. Try another search.');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await section(page);
});

for (const mobile of [false, true]) {
  test(`designation ${mobile ? 'mobile drawer' : 'collapsed desktop'} navigation is keyboard operable`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await login(page);
    await page.goto(`${base()}${list}`);
    if (mobile) {
      await tabTo(page, page.getByTestId('button-open-navigation'));
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('input-search-navigation')).toBeFocused();
      await section(page);
      // Close and reopen a section using the keyboard.
      await tabTo(page, page.getByTestId('button-toggle-user-management'));
      await page.keyboard.press('Space');
      await expect(page.getByTestId('button-toggle-user-management')).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await section(page);
      await tabTo(page, page.getByTestId('link-admin-designations'));
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('link-admin-brand')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('link-admin-designations')).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('designation-mobile-navigation.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('button-open-navigation')).toBeFocused();
      await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
      await page.keyboard.press('Enter');
    } else {
      await tabTo(page, page.getByTestId('button-toggle-sidebar'));
      await page.keyboard.press('Enter');
      await section(page, false);
      await tabTo(page, page.getByTestId('button-search-navigation'));
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('input-search-navigation')).toBeFocused();
      await page.getByTestId('input-search-navigation').fill('designation');
      await expect(page.getByTestId('link-admin-designations')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('button-search-navigation')).toBeFocused();
      await tabTo(page, page.getByTestId('button-toggle-user-management'));
      await page.keyboard.press('Enter');
      await section(page);
    }
    await tabTo(page, page.getByTestId('link-admin-staff'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/staff$/);
    if (mobile) {
      await expect(page.getByTestId('button-open-navigation')).toHaveAttribute('aria-expanded', 'false');
      await tabTo(page, page.getByTestId('button-open-navigation'));
      await page.keyboard.press('Enter');
    }
    await tabTo(page, page.getByTestId('link-admin-designations'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    if (mobile) {
      await expect(page.getByTestId('button-open-navigation')).toHaveAttribute('aria-expanded', 'false');
      await tabTo(page, page.getByTestId('button-open-navigation'));
      await page.keyboard.press('Enter');
    }
    await section(page);
  });
}

test('restricted staff never see User Management or designation links and cannot mount retained designation URLs', async ({ page, browser }) => {
  await login(page);
  const identity = await page.evaluate(async () => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    const designation = await (await import('/src/services/serverDesignations.js')).createDesignation({ name: 'Navigation staff designation', shortName: 'NS', status: 'active' });
    let role = await roles.createRole({ name: 'Navigation restricted staff', description: 'Synthetic navigation test' });
    role = await roles.setRolePermissions(role.id, ['zone.import'], role.version);
    const email = 'navigation-restricted@example.com';
    const made = await staff.createStaff({ name: 'Navigation restricted staff', phone: '9876543210', dialCountry: 'IN',
      email, status: 'active', role: 'Staff', designation_id: designation.id, dateOfJoining: '2026-01-05' });
    await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: true });
    return { userId: made.record.userId, password: made.initial_password };
  });
  const context = await browser.newContext();
  try {
    const restricted = await context.newPage();
    await login(restricted, identity.userId, identity.password);
    await expect(restricted.getByTestId('button-toggle-user-management')).toHaveCount(0);
    for (const query of ['designation', 'User Management']) {
      await restricted.getByTestId('input-search-navigation').fill(query);
      await expect(restricted.getByTestId('status-navigation-empty')).toBeVisible();
      for (const id of ['link-admin-designations', 'link-admin-staff', 'link-admin-roles-permissions']) {
        await expect(restricted.getByTestId(id)).toHaveCount(0);
      }
    }
    for (const path of [list, `${list}/new`, `${list}/00000000-0000-4000-8000-000000000001`, imports, '/admin/staff', '/admin/roles-permissions']) {
      await restricted.goto(`${base()}${path}`);
      await expect(restricted).toHaveURL(/\/admin\/masters\/zones$/);
      await expect(restricted.getByTestId('button-toggle-user-management')).toHaveCount(0);
      await expect(restricted.getByTestId('link-admin-designations')).toHaveCount(0);
      await expect(restricted.getByTestId('button-add-designation')).toHaveCount(0);
    }
  } finally { await context.close(); }
});
