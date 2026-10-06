import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}

const categories = ['basic', 'ui', 'templates', 'communication', 'message-templates'];
const cases = [
  { width: 1440, theme: 'classic', appearance: 'light' },
  { width: 1920, theme: 'modern', appearance: 'dark' },
  { width: 1600, theme: 'modern', appearance: 'light' },
  { width: 1920, theme: 'classic', appearance: 'dark', collapsed: true },
  { width: 1000, theme: 'classic', appearance: 'light' },
  { width: 999, theme: 'modern', appearance: 'dark' },
  { width: 390, theme: 'classic', appearance: 'light' },
  { width: 320, theme: 'modern', appearance: 'dark' },
];

async function checkEdges(page, width) {
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const { left, right, top, bottom, width } = document.querySelector(selector).getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    const body = document.querySelector('.admin-settings-body');
    const panel = body.querySelector('.admin-panel');
    const bounds = panel.getBoundingClientRect();
    return {
      // The authenticated shell no longer renders the old demo-only notice.
      // Measure against the Settings page heading, which shares its content edge.
      contentHead: rect('.admin-page-head'),
      layout: rect('.admin-settings-layout'),
      nav: rect('.admin-settings-nav'),
      body: rect('.admin-settings-body'),
      panel: rect('.admin-settings-body > .admin-panel'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: panel.scrollWidth - panel.clientWidth,
      clippedControls: [...body.querySelectorAll('button, input, select, textarea')].filter((element) => {
        if (!element.getClientRects().length) return false;
        const box = element.getBoundingClientRect();
        return box.left < bounds.left - 1 || box.right > bounds.right + 1;
      }).map((element) => element.getAttribute('data-testid') || element.id || element.textContent),
    };
  });
  for (const area of ['layout', 'body', 'panel']) {
    expect(Math.abs(geometry[area].right - geometry.contentHead.right), `${area} reaches the content edge`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(geometry.layout.left - geometry.contentHead.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.panel.left - geometry.body.left)).toBeLessThanOrEqual(1);
  if (width >= 1000) {
    expect(geometry.nav.width).toBeCloseTo(230, 0);
    expect(geometry.body.left - geometry.nav.right).toBeCloseTo(24, 0);
    if (width >= 1440) expect(geometry.layout.width).toBeGreaterThan(1100);
  } else {
    expect(geometry.body.top).toBeGreaterThanOrEqual(geometry.nav.bottom);
    expect(Math.abs(geometry.body.left - geometry.contentHead.left)).toBeLessThanOrEqual(1);
  }
  expect(geometry.overflow, 'no page horizontal overflow').toBeLessThanOrEqual(1);
  expect(geometry.panelOverflow, 'no hidden horizontal panel clipping').toBeLessThanOrEqual(1);
  expect(geometry.clippedControls).toEqual([]);
}

for (const scenario of cases) {
  test(`Settings fill the workspace at ${scenario.width}px in ${scenario.theme}/${scenario.appearance}${scenario.collapsed ? ' with collapsed sidebar' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 950 });
    await authenticateAdmin(page);
    const base = process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
    await page.goto(`${base}/admin/settings?tab=ui&source=layout-check`);
    await page.getByTestId('select-admin-theme').selectOption(scenario.theme);
    await page.getByTestId('select-admin-appearance').selectOption(scenario.appearance);
    if (scenario.collapsed) await page.getByTestId('button-toggle-sidebar').click();
    await page.reload();
    await expect(page.getByTestId('select-admin-theme')).toHaveValue(scenario.theme);
    await expect(page.getByTestId('select-admin-appearance')).toHaveValue(scenario.appearance);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', scenario.theme);
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', scenario.appearance);

    for (const id of categories) {
      await page.getByTestId(`link-settings-${id}`).click();
      await expect(page.getByTestId(`link-settings-${id}`)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.admin-settings-body > .admin-panel')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('source')).toBe('layout-check');
      await checkEdges(page, scenario.width);
      if (id === 'templates') {
        for (const type of ['po', 'pr']) {
          await page.getByLabel('Document type').selectOption(type);
          await expect(page.locator('.po-tpl__card')).toHaveCount(3);
          await checkEdges(page, scenario.width);
          for (const preview of await page.locator('.po-tpl__preview').all()) {
            await expect(preview).toHaveCSS('height', '300px');
            await expect(preview.locator('svg')).toBeVisible();
          }
        }
      }
    }
  });
}
