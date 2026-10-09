import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({
  launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] },
});

// Deliberately scope notice checks to listings. Forms, imports, operation
// feedback and confirmations may still explain server/legacy/export behavior.
const listings = [
  ['courier-partners', 'Courier Partner Master', 'Add courier partner'],
  ['headquarters', 'Headquarter Master', 'Add headquarter', 'State Code is an HQ-name abbreviation, not a geographic state identifier.'],
  ['product-categories', 'Product Category Master', 'Add category', 'Shared Allergen Master uses this live directory.'],
  ['storage-locations', 'Storage Location Master', 'Add storage location', 'Shared Allergen Master uses this live directory.'],
  ['allergens', 'Allergen Master', 'Add product', 'Mix / No Mix is catalogue metadata only.'],
  ['vendors', 'Vendor Master', 'Add vendor'],
  ['designations', 'Designation Master', 'Add designation', 'Designation labels do not grant staff permissions or change payroll.'],
  ['sales-targets', 'Sales Target Master', 'Add target', 'Targets for MRs by financial year.'],
  ['doctors', 'Doctor Master', 'Add doctor', 'No doctor login or payment ledger is created.'],
];
const retainedListings = [
  ['mrs', 'MR Master', 'Each MR has a login account using the User ID.'],
  ['patients', 'Patient Master', 'Doctor, MR and Zone references come from the server. No dosage history is recorded here.'],
  ['opening-balances', 'Opening Balance Master', 'This register does not post ledger entries or calculate payment balances.'],
];
const removedNotices = /authenticated audit history|shared server records|shared server targets|(?:clearing browser data|browser data clearing)|old browser|browser-local|local browser|not migrated|used as fallback|legacy CSV backup|existing CSV backup|exports? (?:include|cover)|exports and the summary|5,000|narrower filters|demo (?:procurement|inventory)|procurement demos/i;

async function login(page) {
  expect(process.env.EVEXIA_ISOLATED_AUTH_PREVIEW).toBe('1');
  await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible({ timeout: 45_000 });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`master listings retain guidance and controls without notices at ${viewport.width}px`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await login(page);
    for (const [slug, title, add, guidance] of listings) {
      await test.step(title, async () => {
        await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/masters/${slug}`);
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.getByLabel('Rows per page')).toBeVisible();
        await expect(page.getByRole('button', { name: add, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import data', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeEnabled();
        await expect(page.locator('.admin-search input')).toBeVisible();
        await expect(page.locator('section.admin-panel').locator('table:visible, .admin-empty:visible, [role="list"]:visible').first()).toBeVisible();
        if (slug === 'allergens') {
          await expect(page.locator('.admin-filter button[role="combobox"]')).toHaveCount(4);
          await expect(page.getByTestId('select-filter-status')).toBeVisible();
        } else {
          expect(await page.locator('.admin-filter select').count()).toBeGreaterThan(0);
        }
        await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeVisible();
        const descriptions = page.locator('.admin-page-head__description');
        for (const text of await descriptions.allTextContents()) {
          expect(text.trim()).not.toBe('');
          // Doctor's purpose sentence is intentionally preserved.
          if (slug !== 'doctors') expect(text).not.toMatch(removedNotices);
        }
        await expect(descriptions).toHaveCount(guidance ? 1 : 0);
        if (guidance) await expect(descriptions).toContainText(guidance);
        await expect(page.getByText(removedNotices)).toHaveCount(0);
        await expect(page.locator('p.admin-panel__foot')).toHaveCount(0);
        // Check the changed header/footer surfaces, not intrinsic table width
        // or offscreen accessibility labels belonging to existing record rows.
        // The panel immediately follows the header, with no empty containers.
        const geometry = await page.evaluate(() => {
          const header = document.querySelector('.admin-page-head');
          const head = header.getBoundingClientRect();
          const panel = document.querySelector('section.admin-panel').getBoundingClientRect();
          const surfaces = [head, panel, ...[...header.querySelectorAll('h1, p, button'),
            ...document.querySelectorAll('.admin-pagination, .admin-pagination button, .admin-pagination select')]
            .map((el) => el.getBoundingClientRect())];
          return {
            gap: panel.top - head.bottom,
            rightOverflow: Math.max(...surfaces.map((rect) => rect.right)) - innerWidth,
            leftEdge: Math.min(...surfaces.map((rect) => rect.left)),
            empty: [...document.querySelectorAll('.admin-page-head p')].some((p) => !p.textContent.trim()),
          };
        });
        expect(geometry.empty).toBe(false);
        expect(geometry.gap).toBeGreaterThanOrEqual(0);
        expect(geometry.gap).toBeLessThanOrEqual(24);
        expect(geometry.rightOverflow).toBeLessThanOrEqual(1);
        expect(geometry.leftEdge).toBeGreaterThanOrEqual(0);
        if (slug === 'courier-partners' || slug === 'allergens') await info.attach(`${slug}-${viewport.width}`, {
          body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
        });
        // Static help removal must not suppress actionable server limit errors.
        const exportRoute = /\/api\/v1\/admin\/[^/]+\/export(?:\?|$)/;
        await page.route(exportRoute, (route) => route.fulfill({
          status: 422, contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'export_limit', message: 'Exports support up to 5,000 records. Narrow your filters.' } }),
        }));
        await page.getByRole('button', { name: 'Export data', exact: true }).click();
        await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Exports support up to 5,000 records. Narrow your filters.');
        await page.unroute(exportRoute);
      });
    }
    for (const [slug, title, guidance] of retainedListings) {
      await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/masters/${slug}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.locator('.admin-page-head__description')).toContainText(guidance);
      await expect(page.getByLabel('Rows per page')).toBeVisible();
    }
    // Observe the existing Zone cleanup, without editing or reimplementing it.
    await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/masters/zones`);
    await expect(page.getByRole('heading', { name: 'Zone Master', exact: true })).toBeVisible();
    await expect(page.getByLabel('Rows per page')).toBeVisible();
    await expect(page.getByText(removedNotices)).toHaveCount(0);
  });
}
