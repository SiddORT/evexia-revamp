import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { choosePhoneCountry } from './helpers/searchableChoice.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;

async function menuFits(page, owner) {
  const menu = page.locator(`[data-searchable-owner="${owner}"]`);
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: getComputedStyle(node).overflowY };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.height).toBeLessThanOrEqual(321);
  expect(bounds.overflow).toBe('auto');
}

test('Doctor Patient dropdowns fit cold routes and aligned filters in light dark at mobile tablet desktop', async ({ page }, info) => {
  test.setTimeout(180000);
  await authenticateAdmin(page);
  // No record mutations: only disclose the conditional Missing MR action.
  await page.route('**/api/v1/admin/doctors/filters*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), missingMR: true } });
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const appearance of ['light', 'dark']) {
      for (const kind of ['doctors', 'patients']) {
        const prefix = kind === 'doctors' ? 'doctor' : 'patient';
        await page.goto(`${base()}/admin/masters/${kind}/new`);
        await expect(page.getByTestId(`form-${prefix}`)).toBeVisible();
        await page.evaluate(async (appearance) => {
          const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
          setAdminPreference('appearance', appearance);
        }, appearance);
        const country = page.getByTestId(`select-${prefix}-dialCountry`);
        await country.click();
        await menuFits(page, `${prefix}-dialCountry`);
        await expect(page.locator(`[data-searchable-owner="${prefix}-dialCountry"]`)).toHaveAttribute('data-admin-appearance', appearance);
        await country.fill('Singapore');
        await expect(page.getByRole('option', { name: 'Singapore (SG) +65', exact: true })).toBeVisible();
        await country.fill('+65');
        await expect(page.getByRole('option', { name: 'Singapore (SG) +65', exact: true })).toBeVisible();
        await choosePhoneCountry(page, country, 'SG');
        const phone = await page.getByTestId(`input-${prefix}-phone`).boundingBox();
        expect(phone.width).toBeGreaterThan(100);
        if (kind === 'patients') {
          await expect(page.getByText(/Patient data is saved to the server\. Age uses/)).toHaveCount(0);
          await page.getByTestId('button-save-patient').click();
          await page.getByTestId('tab-patient-care').click();
          const language = page.getByRole('combobox', { name: 'Instructions language' });
          await expect(language).toHaveAttribute('aria-invalid', 'true');
          await expect(language).toHaveAttribute('aria-describedby', 'patient-instructionsLanguage-error');
          await language.click();
          await menuFits(page, 'patient-instructionsLanguage');
          await language.fill('zzz');
          await language.press('Enter');
          await expect(page.getByTestId('error-patient-instructionsLanguage')).toBeVisible();
          await language.fill('tAm');
          await expect(page.getByRole('listbox', { name: 'Instructions language' }).getByRole('option')).toHaveCount(1);
          await language.press('ArrowDown');
          await language.press('Enter');
          await expect(language).toHaveValue('Tamil');
          await expect(language).toHaveAttribute('aria-invalid', 'false');
          await language.click();
          await menuFits(page, 'patient-instructionsLanguage');
          if (width === 390) await page.screenshot({ path: info.outputPath(`patient-language-${appearance}.png`), fullPage: true });
          await language.press('Escape');
        } else {
          await page.getByTestId('tab-doctor-clinic').click();
          await expect(page.getByRole('combobox', { name: 'MR Name' })).toHaveAttribute('aria-required', 'true');
          await expect(page.locator('label[for="doctor-mrId"]')).toHaveCount(1);
        }
      }
      await page.goto(`${base()}/admin/masters/doctors`);
      await expect(page.getByTestId('button-export-doctors')).toBeEnabled();
      await page.getByTestId('button-toggle-doctor-filters').click();
      await expect(page.getByRole('button', { name: 'Missing MR', exact: true })).toBeVisible();
      const geometry = await page.locator('.doctor-master__filter-grid > .admin-filter').evaluateAll((fields) =>
        fields.map((field) => {
          const label = field.querySelector('label');
          const input = field.querySelector('input, select');
          const control = input.closest('.searchable-control__control') || input;
          const l = label.getBoundingClientRect(), c = control.getBoundingClientRect();
          return { labels: input.labels.length, labelBottom: l.bottom, top: c.top, height: c.height, left: c.left, right: c.right };
        }));
      expect(geometry).toHaveLength(4);
      for (const item of geometry) {
        expect(item.labels).toBe(1);
        expect(item.height).toBe(40);
        expect(item.left).toBeGreaterThanOrEqual(0);
        expect(item.right).toBeLessThanOrEqual(width);
      }
      if (width === 1440) {
        expect(Math.max(...geometry.map((g) => g.top)) - Math.min(...geometry.map((g) => g.top))).toBeLessThan(1);
        expect(Math.max(...geometry.map((g) => g.labelBottom)) - Math.min(...geometry.map((g) => g.labelBottom))).toBeLessThan(1);
      }
      const mr = page.getByRole('combobox', { name: 'MR', exact: true });
      await expect(mr).toHaveAttribute('aria-required', 'false');
      const actions = await page.locator('.doctor-master__mr-filter-actions').boundingBox();
      expect(actions.y).toBeGreaterThanOrEqual(geometry[1].top + geometry[1].height);
      await page.screenshot({ path: info.outputPath(`doctor-filters-${width}-${appearance}.png`), fullPage: true });
      const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/doctors' && new URL(r.url()).searchParams.get('mr_id') === 'missing');
      await page.getByRole('button', { name: 'Missing MR', exact: true }).click();
      await response;
      const reset = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/doctors' && !new URL(r.url()).searchParams.has('mr_id'));
      await page.getByRole('button', { name: 'All MRs', exact: true }).click();
      await reset;
      await expect(page.getByTestId('button-export-doctors')).toBeEnabled();
    }
  }
});
