import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
// Explicit contract rather than importing the implementation's menu data.
const destinations = [
  ['immunotherapy', 'IMMUNOTHERAPY'],
  ['kits-consumables', 'KITS & CONSUMABLES'],
  ['spt', 'SPT'],
  ['lupin', 'LUPIN'],
];
const route = (slug) => `/admin/orders/${slug}`;
const child = (page, slug) => page.getByTestId(`link-admin-orders-${slug}`);
const orders = (page) => page.getByTestId('button-toggle-orders');

async function login(page, identifier = 'crm-admin@allergyevexia.in', password = process.env.EVEXIA_TEST_ADMIN_PASSWORD) {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}

async function tabTo(page, target) {
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Navigation control was not keyboard reachable');
}

async function selected(page, slug, label) {
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  if (slug === 'spt') {
    await expect(page.getByTestId('status-spt-demo')).toContainText('demo');
    await expect(page.getByRole('link', { name: 'Add Order', exact: true })).toBeVisible();
    await expect(page.getByTestId('status-order-placeholder')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('status-order-placeholder')).toContainText('this order page is not built yet');
  }
  await expect(orders(page)).toHaveClass(/admin-nav__item--active/);
  await expect(orders(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(child(page, slug)).toHaveClass(/admin-nav__item--active/);
  await expect(child(page, slug)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#admin-orders-subnav a[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId('button-toggle-inventory')).not.toHaveClass(/admin-nav__item--active/);
  await expect(page.getByTestId('button-toggle-user-management')).not.toHaveClass(/admin-nav__item--active/);
}

test('Orders sits between Inventory and User Management; all links and direct destinations select their parent', async ({ page }) => {
  await login(page);
  await expect(page.locator('.admin-nav > button')).toHaveText(['Masters', 'Inventory', 'Orders', 'User Management']);
  await expect(orders(page)).toHaveAttribute('aria-expanded', 'false');
  await orders(page).click();
  await expect(page.locator('#admin-orders-subnav a')).toHaveText(destinations.map(([, label]) => label));
  for (const [slug, label] of destinations) {
    await expect(child(page, slug)).toHaveAttribute('href', route(slug));
    await child(page, slug).click();
    await expect(page).toHaveURL(new RegExp(`${route(slug)}$`));
    await selected(page, slug, label);
    await page.goto(`${base()}${route(slug)}`);
    await selected(page, slug, label);
    if (slug === 'kits-consumables') await expect(page.getByText('Covers kits, lancets and applicators.')).toBeVisible();
  }
  await page.getByTestId('button-toggle-inventory').click();
  await page.getByTestId('link-admin-stock-status').click();
  await expect(page.getByRole('heading', { name: 'Stock status', exact: true })).toBeVisible();
  await expect(page.getByTestId('button-toggle-inventory')).toHaveClass(/admin-nav__item--active/);
  await page.getByTestId('button-toggle-user-management').click();
  await page.getByTestId('link-admin-designations').click();
  await expect(page.getByRole('heading', { name: 'Designation Master', exact: true })).toBeVisible();
  await expect(page.getByTestId('button-toggle-user-management')).toHaveClass(/admin-nav__item--active/);
  await expect(orders(page)).not.toHaveClass(/admin-nav__item--active/);
});

test('Orders search matches labels and supply aliases without false empty results', async ({ page }) => {
  await login(page);
  const search = page.getByTestId('input-search-navigation');
  for (const [query, expected] of [
    ['orders', destinations.map(([slug]) => slug)],
    [' Immunotherapy ', ['immunotherapy']],
    ['KITS & CONSUMABLES', ['kits-consumables']],
    ['kit', ['kits-consumables']], ['lancet', ['kits-consumables']], ['applicator', ['kits-consumables']],
    ['SPT', ['spt']], ['lupin', ['lupin']],
  ]) {
    await search.fill(query);
    await expect(orders(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(orders(page)).toBeDisabled();
    await expect(page.locator('#admin-orders-subnav a')).toHaveCount(expected.length);
    for (const slug of expected) await expect(child(page, slug)).toBeVisible();
    await expect(page.getByTestId('status-navigation-empty')).toHaveCount(0);
  }
  await search.fill('no-such-navigation-result');
  await expect(page.getByTestId('status-navigation-empty')).toBeVisible();
  await expect(orders(page)).toHaveCount(0);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(orders(page)).toBeEnabled();
});

for (const mobile of [false, true]) {
  test(`Orders supports keyboard toggles and ${mobile ? 'mobile drawer' : 'collapsed desktop'} navigation`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await login(page);
    await page.goto(`${base()}${route('immunotherapy')}`);
    await expect(page.getByRole('heading', { name: 'IMMUNOTHERAPY', exact: true })).toBeVisible();
    if (mobile) {
      await tabTo(page, page.getByTestId('button-open-navigation'));
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('input-search-navigation')).toBeFocused();
    } else {
      await tabTo(page, page.getByTestId('button-toggle-sidebar'));
      await page.keyboard.press('Enter');
      await expect(orders(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(orders(page)).toHaveClass(/admin-nav__item--active/);
      await expect(orders(page)).toHaveAttribute('title', 'Expand Orders');
      await tabTo(page, page.getByTestId('button-search-navigation'));
      await page.keyboard.press('Enter');
      await page.getByTestId('input-search-navigation').fill('lancet');
      await expect(child(page, 'kits-consumables')).toBeVisible();
      await expect(page.getByTestId('status-navigation-empty')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('button-search-navigation')).toBeFocused();
    }
    await tabTo(page, orders(page));
    await page.keyboard.press('Enter');
    await expect(orders(page)).toHaveAttribute('aria-expanded', mobile ? 'false' : 'true');
    if (mobile) await page.keyboard.press('Space');
    await expect(child(page, 'kits-consumables')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(orders(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(orders(page)).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: testInfo.outputPath('orders-navigation.png') });
    await tabTo(page, child(page, 'kits-consumables'));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'KITS & CONSUMABLES', exact: true })).toBeVisible();
    if (mobile) {
      await expect(page.getByTestId('button-open-navigation')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#admin-navigation')).toHaveAttribute('aria-hidden', 'true');
      await tabTo(page, page.getByTestId('button-open-navigation'));
      await page.keyboard.press('Enter');
      await expect(orders(page)).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('button-open-navigation')).toBeFocused();
    } else {
      await selected(page, 'kits-consumables', 'KITS & CONSUMABLES');
    }
  });
}

test('long Orders labels fit existing classic/modern light/dark themes on desktop and mobile', async ({ page }, testInfo) => {
  await login(page);
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme);
      localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base()}${route('kits-consumables')}`);
      await expect(page.getByRole('heading', { name: 'KITS & CONSUMABLES', exact: true })).toBeVisible();
      if (width === 390) await page.getByTestId('button-open-navigation').click();
      // Wait for the existing drawer transition, not merely its open attribute.
      if (width === 390) await expect.poll(() => page.locator('#admin-navigation').evaluate((el) => el.getBoundingClientRect().left)).toBe(0);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      for (const [slug] of destinations) {
        await expect(child(page, slug)).toBeVisible();
        expect(await child(page, slug).evaluate((el) => {
          const label = el.querySelector('.admin-nav__label');
          return label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1
            && el.scrollWidth <= el.clientWidth + 1;
        })).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`orders-${theme}-${appearance}-${width}.png`) });
    }
  }
});

test('anonymous and restricted staff cannot mount Orders; staff search does not reveal it', async ({ page, browser }) => {
  for (const [slug] of destinations) {
    await page.goto(`${base()}${route(slug)}`);
    await expect(page.getByTestId('button-submit-login')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
    await expect(page.getByTestId('status-order-placeholder')).toHaveCount(0);
  }
  await login(page);
  const identity = await page.evaluate(async () => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    let role = await roles.createRole({ name: 'Orders restricted staff', description: 'Synthetic navigation test' });
    role = await roles.setRolePermissions(role.id, ['zone.import'], role.version);
    const made = await staff.createStaff({ name: 'Orders restricted staff', phone: '9876543210', dialCountry: 'IN',
      email: 'orders-restricted@example.com', status: 'active', role: 'Staff', designation: 'Executive', dateOfJoining: '2026-01-05' });
    await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: true });
    return { userId: made.record.userId, password: made.initial_password };
  });
  const context = await browser.newContext();
  try {
    const restricted = await context.newPage();
    await login(restricted, identity.userId, identity.password);
    await expect(restricted).toHaveURL(/\/admin\/masters\/zones$/);
    await expect(orders(restricted)).toHaveCount(0);
    for (const query of ['orders', 'immunotherapy', 'kit', 'lancet', 'applicator', 'spt', 'lupin']) {
      await restricted.getByTestId('input-search-navigation').fill(query);
      await expect(restricted.getByTestId('status-navigation-empty')).toBeVisible();
      await expect(restricted.locator('#admin-orders-subnav a')).toHaveCount(0);
    }
    for (const [slug] of destinations) {
      await restricted.goto(`${base()}${route(slug)}`);
      await expect(restricted).toHaveURL(/\/admin\/masters\/zones$/);
      await expect(orders(restricted)).toHaveCount(0);
      await expect(restricted.getByTestId('status-order-placeholder')).toHaveCount(0);
    }
  } finally { await context.close(); }
});
