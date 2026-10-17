import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const destination = '/admin/settings?tab=role-urls';
const viewports = [
  { width: 1440, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const categories = ['basic', 'ui', 'templates', 'communication', 'message-templates'];

async function ready(page) {
  await expect(page.getByRole('region', { name: 'Role URLs settings', exact: true })).toBeVisible();
  await expect(page.locator('.role-urls')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('panel-primary-domain')).toBeVisible();
  await expect(page.getByTestId('button-role-url-add')).toBeEnabled();
  await expect(page.locator('.role-urls [role="alert"]')).toHaveCount(0);
}

async function presentation(page, scale = 1) {
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Role URLs Shared setting', exact: true, level: 2 })).toBeVisible();
  for (const name of ['Role mappings', 'Primary domain', 'Connect each hostname separately']) {
    await expect(page.getByRole('heading', { name, exact: true, level: 3 })).toBeVisible();
  }
  const styles = await page.locator('.role-urls').evaluate((panel) => {
    const style = (element) => {
      const css = getComputedStyle(element);
      return { family: css.fontFamily, size: parseFloat(css.fontSize), weight: css.fontWeight };
    };
    const css = getComputedStyle(panel);
    const intro = panel.querySelector('.role-urls__intro').getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    return {
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      panel: style(panel),
      title: style(panel.querySelector('h2')),
      headings: [...panel.querySelectorAll('.role-urls__h')].map(style),
      body: style(panel.querySelector('.role-urls__description')),
      input: style(panel.querySelector('input[type="search"]')),
      button: style(panel.querySelector('[data-testid="button-role-url-add"]')),
      hint: style(panel.querySelector('.role-urls__boundary')),
      padding: ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(css[`padding${side}`])),
      inset: intro.left - bounds.left - parseFloat(css.borderLeftWidth),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(styles.rootSize).toBeCloseTo(16 * scale, 1);
  // Literal expected values, not values derived from the stylesheet under test.
  for (const [name, size] of [['panel', 14], ['title', 20], ['body', 14], ['input', 14], ['button', 14], ['hint', 13]]) {
    expect(styles[name].family, `${name} uses the portal sans-serif family`).toMatch(/DM Sans.*sans-serif/);
    expect(styles[name].size, `${name} size`).toBeCloseTo(size * scale, 1);
  }
  expect(styles.headings.length).toBeGreaterThanOrEqual(3);
  for (const heading of [styles.title, ...styles.headings]) {
    expect(heading.family).toMatch(/DM Sans.*sans-serif/);
    expect(heading.weight).toBe('700');
  }
  for (const heading of styles.headings) expect(heading.size).toBeCloseTo(18 * scale, 1);
  const expectedPadding = Math.min(28, Math.max(16, page.viewportSize().width * 0.02));
  for (const padding of styles.padding) expect(padding).toBeCloseTo(expectedPadding, 1);
  expect(styles.inset).toBeCloseTo(expectedPadding, 1);
  expect(styles.overflow, 'Role URLs does not widen the document').toBeLessThanOrEqual(1);
}

async function sharedStylesLast(page) {
  // Exercise the actual shared rules arriving after the panel's owned rules.
  // Vite marks these style nodes; fail rather than silently skip the ordering check.
  const moved = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('style[data-vite-dev-id]')]
      .filter((node) => /\/(admin|adminSettings)\.css$/.test(node.dataset.viteDevId));
    for (const node of nodes) document.head.append(node);
    return nodes.map((node) => node.dataset.viteDevId.split('/').pop()).sort();
  });
  expect(moved).toEqual(['admin.css', 'adminSettings.css']);
}

for (const viewport of viewports) {
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    for (const entry of ['direct', 'navigation']) {
      test(`Role URLs presentation ${entry} ${viewport.width}px ${theme} ${appearance}`, async ({ page }, info) => {
        test.setTimeout(120_000);
        // Never accept a live deployment or persist a mapping/domain mutation.
        expect(process.env.EVEXIA_ISOLATED_AUTH_PREVIEW).toBe('1');
        await page.setViewportSize(viewport);
        await page.addInitScript(({ theme, appearance }) => {
          localStorage.setItem('evexia.admin.theme', theme);
          localStorage.setItem('evexia.admin.appearance', appearance);
        }, { theme, appearance });
        const writes = [];
        page.on('request', (request) => {
          if (/\/api\/v1\/admin\/role-urls(?:\/|$)/.test(new URL(request.url()).pathname) &&
              request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        });
        await page.route(/\/api\/v1\/admin\/role-urls(?:\/|$)/, (route) =>
          route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
        // API login installs a real refresh cookie without warming any UI/CSS.
        await authenticateAdmin(page);
        if (entry === 'direct') {
          await page.goto(`${base()}${destination}`);
        } else {
          await page.goto(`${base()}/admin`);
          await expect(page.getByTestId('button-admin-profile')).toBeVisible();
          await page.getByTestId('button-admin-profile').click();
          await page.getByTestId('link-admin-settings').click();
          await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
          await page.getByTestId('link-settings-role-urls').click();
        }
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
        await presentation(page);
        if (entry === 'navigation') {
          for (const category of categories) {
            await page.getByTestId(`link-settings-${category}`).click();
            await expect(page.getByTestId(`link-settings-${category}`)).toHaveAttribute('aria-current', 'page');
            await expect(page.locator('.role-urls')).toHaveCount(0);
            await page.getByTestId('link-settings-role-urls').click();
            await presentation(page);
          }
        } else {
          await page.reload();
          await presentation(page);
        }
        await sharedStylesLast(page);
        await presentation(page);
        // Open only an empty local draft to check the fourth heading level.
        await page.getByTestId('button-role-url-add').click();
        const editorHeading = page.getByRole('heading', { name: 'Add Role URL', exact: true, level: 4 });
        await expect(editorHeading).toBeVisible();
        await expect(editorHeading).toHaveCSS('font-size', '16px');
        await expect(editorHeading).toHaveCSS('font-weight', '700');
        await expect(editorHeading).toHaveCSS('font-family', /DM Sans.*sans-serif/);
        await page.getByTestId('button-role-url-cancel').click();
        await expect(page.getByTestId('form-role-url')).toHaveCount(0);
        // Check actual computed 200% rem text, not an inert zoom declaration.
        await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
        await presentation(page, 2);
        if (theme === 'classic' && appearance === 'light') {
          await page.screenshot({ path: info.outputPath(`role-urls-${entry}-${viewport.width}-200pct.png`), fullPage: true });
        }
        expect(writes, 'Layout coverage must never mutate domain configuration').toEqual([]);
      });
    }
  }
}
