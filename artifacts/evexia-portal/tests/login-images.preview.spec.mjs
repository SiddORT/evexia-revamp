import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const scenarios = [
  ...['classic', 'modern'].flatMap((theme) =>
    ['light', 'dark'].map((appearance) => ({ role: 'admin', path: '/admin/login', theme, appearance }))),
  { role: 'mr', path: '/mr', theme: 'modern', appearance: 'dark' },
  { role: 'doctor', path: '/doctor', theme: 'modern', appearance: 'dark' },
];

for (const scenario of scenarios) {
  for (const width of [1440, 390, 320]) {
    test(`untinted ${scenario.role} login: ${scenario.theme}/${scenario.appearance} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(({ theme, appearance }) => {
        localStorage.setItem('evexia.admin.theme', theme);
        localStorage.setItem('evexia.admin.appearance', appearance);
      }, scenario);
      await page.goto(`${base()}${scenario.path}`);
      const visual = page.locator('.auth-visual');
      await expect(visual.locator('img')).toBeVisible();
      await expect(visual.locator('img')).toHaveAttribute('src', `/images/${scenario.role}-role.jpg`);
      expect(await visual.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(visual.locator('img')).toHaveCSS('filter', 'saturate(0.72)');
      await expect(visual.locator('img')).toHaveCSS('opacity', '0.93');
      await expect(visual.locator('img')).toHaveCSS('object-fit', 'cover');
      const layers = await visual.evaluate((element) =>
        [element, element.querySelector('.auth-visual__overlay')].flatMap((layer) =>
          [null, '::before', '::after'].map((pseudo) => {
            const style = getComputedStyle(layer, pseudo);
            return { image: style.backgroundImage, content: style.content };
          })));
      expect(layers.every((layer) => layer.image === 'none')).toBe(true);
      expect(layers[2].content).toBe('none');
      await expect(visual.locator('h2')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(visual.locator('h2')).not.toHaveCSS('text-shadow', 'none');
      await expect(page.locator('.auth-page')).not.toHaveAttribute('data-admin-appearance');
      if (scenario.role === 'admin') {
        await expect(page.locator('.auth-page')).toHaveAttribute('data-admin-theme', scenario.theme);
      } else {
        await expect(page.locator('.auth-page')).not.toHaveAttribute('data-admin-theme');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.brand-mark__image')).toBeVisible();
      if (process.env.EVEXIA_LOGIN_SCREENSHOTS) {
        await page.screenshot({
          path: `${process.env.EVEXIA_LOGIN_SCREENSHOTS}/${scenario.role}-${scenario.theme}-${scenario.appearance}-${width}.png`,
          fullPage: true,
        });
      }
      await page.getByTestId('button-submit-login').click();
      await expect(page.locator('.field__error')).toHaveCount(2);
      await page.getByLabel('Password', { exact: true }).fill('preview-only');
      await page.getByTestId('button-toggle-password').click();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
      await page.getByTestId('checkbox-remember').check();
      await expect(page.getByTestId('checkbox-remember')).toBeChecked();
    });
  }
}
