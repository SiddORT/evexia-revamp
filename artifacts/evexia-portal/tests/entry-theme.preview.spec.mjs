import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const primary = { modern: 'rgb(24, 115, 104)', classic: 'rgb(201, 74, 54)' };

async function seed(page, value, blocked = false) {
  await page.addInitScript(({ value, blocked }) => {
    if (!sessionStorage.getItem('entry-theme-fixture-seeded')) {
      if (value !== null) localStorage.setItem('evexia.admin.theme', value);
      localStorage.setItem('evexia.admin.appearance', 'dark');
      sessionStorage.setItem('entry-theme-fixture-seeded', 'yes');
    }
    if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    // Record the first committed page, not just its settled theme.
    window.firstEntryTheme = null;
    new MutationObserver(() => {
      const entry = document.querySelector('.entry-theme');
      if (entry && window.firstEntryTheme === null) window.firstEntryTheme = entry.dataset.adminTheme;
    }).observe(document, { childList: true, subtree: true });
  }, { value, blocked });
}

async function checkTheme(page, theme, login) {
  await expect(page.locator('.entry-theme')).toHaveAttribute('data-admin-theme', theme);
  expect(await page.evaluate(() => window.firstEntryTheme)).toBe(theme);
  await expect(page.locator('.entry-theme')).not.toHaveAttribute('data-admin-appearance');
  await expect(page.locator(login ? '.submit-button' : '.portal-card__cta').first())
    .toHaveCSS(login ? 'background-color' : 'color', primary[theme]);
  if (theme === 'modern') {
    await expect(page.locator(login ? '.auth-panel' : '.portal-page')).toHaveCSS('background-color', 'rgb(247, 245, 250)');
  }
  await expect(page.locator('.brand-mark__image')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  for (const element of await page.locator(login ? '.auth-form input, .auth-form button, .auth-back' : '.portal-card').all()) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  }
}

for (const theme of ['classic', 'modern']) {
  for (const width of [1440, 320]) {
    test(`${theme} entry screens load directly and refresh at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await seed(page, theme);
      for (const path of ['/', '/admin/login']) {
        await page.goto(`${base()}${path}`);
        await checkTheme(page, theme, path !== '/');
        await page.reload();
        await checkTheme(page, theme, path !== '/');
      }
      const email = page.getByLabel('Email or username');
      await email.focus();
      await expect(email).toHaveCSS('border-color', theme === 'modern' ? 'rgb(18, 107, 97)' : primary.classic);
      await page.getByTestId('button-submit-login').click();
      await expect(page.locator('.field__error')).toHaveCount(2);
      await expect(email).toHaveAttribute('aria-invalid', 'true');
      await email.focus();
      await expect(email).toHaveCSS('border-color', theme === 'modern' ? 'rgb(169, 60, 44)' : primary.classic);
    });
  }
}

for (const scenario of [{ value: null }, { value: '__proto__' }, { value: 'modern', blocked: true }]) {
  test(`Classic fallback for ${scenario.blocked ? 'inaccessible' : scenario.value === null ? 'missing' : 'invalid'} storage`, async ({ page }) => {
    await seed(page, scenario.value, scenario.blocked);
    for (const path of ['/', '/admin/login']) {
      await page.goto(`${base()}${path}`);
      await checkTheme(page, 'classic', path !== '/');
    }
  });
}

test('MR and Doctor retain Classic styling even with Modern/dark saved', async ({ page }) => {
  await seed(page, 'modern');
  for (const path of ['/mr', '/doctor']) {
    await page.goto(`${base()}${path}`);
    await expect(page.locator('.auth-page')).not.toHaveAttribute('data-admin-theme');
    await expect(page.locator('.entry-theme')).toHaveCount(0);
    await expect(page.locator('.submit-button')).toHaveCSS('background-color', primary.classic);
    await expect(page.locator('.auth-panel')).toHaveCSS('background-color', 'rgb(252, 252, 251)');
    await page.getByLabel('Email or username').focus();
    await expect(page.getByLabel('Email or username')).toHaveCSS('border-color', primary.classic);
  }
});

for (const theme of ['modern', 'classic']) {
  test(`Settings ${theme} choice survives home navigation and real logout`, async ({ page }) => {
    await seed(page, theme === 'modern' ? 'classic' : 'modern');
    await authenticateAdmin(page);
    await page.goto(`${base()}/admin/settings?tab=ui`);
    await page.getByTestId('select-admin-theme').selectOption(theme);
    await page.getByTestId('select-admin-appearance').selectOption('dark');
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
    // SPA navigation preserves the shared source and does not force a storage read.
    await page.evaluate(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('.portal-page')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.portal-card__cta').first()).toHaveCSS('color', primary[theme]);
    await page.getByTestId('link-portal-admin').click();
    await expect(page.locator('.submit-button')).toHaveCSS('background-color', primary[theme]);
    await page.goto(`${base()}/admin/settings?tab=ui`);
    await expect(page.getByTestId('select-admin-theme')).toHaveValue(theme);
    await page.getByTestId('button-admin-profile').click();
    await page.getByTestId('link-admin-sign-out').click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.locator('.auth-page')).toHaveAttribute('data-admin-theme', theme);
    await expect(page.locator('.submit-button')).toHaveCSS('background-color', primary[theme]);
    await page.getByTestId('link-back-portals').click();
    await expect(page.locator('.portal-page')).toHaveAttribute('data-admin-theme', theme);
    await page.reload();
    await checkTheme(page, theme, false);
  });
}

test('failed persistence retains a Settings choice through same-visit navigation and logout', async ({ page }) => {
  await seed(page, null, true);
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin/settings?tab=ui`);
  await page.getByTestId('select-admin-theme').selectOption('modern');
  await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', 'modern');
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-sign-out').click();
  await expect(page.locator('.auth-page')).toHaveAttribute('data-admin-theme', 'modern');
  await page.getByTestId('link-back-portals').click();
  await expect(page.locator('.portal-page')).toHaveAttribute('data-admin-theme', 'modern');
  await page.getByTestId('link-portal-admin').click();
  await expect(page.locator('.auth-page')).toHaveAttribute('data-admin-theme', 'modern');
  await page.reload();
  await checkTheme(page, 'classic', true);
});
