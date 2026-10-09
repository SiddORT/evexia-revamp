import { expect } from '@playwright/test';
import { authenticateAdmin } from './authenticateAdmin.mjs';
import { enlargeTargetText, targetKeyboardReach } from './salesTargetLayout.mjs';

async function toolbarFits(page) {
  // Check the changed surfaces independently of the record table's scroll area.
  const failures = await page.locator('.admin-target-toolbar').evaluate((root) => {
    const failures = [];
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getClientRects().length || node.closest('svg, .sr-only') || node.matches('option')) continue;
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const css = getComputedStyle(node);
      const label = `${node.tagName}.${node.className}`;
      if (box.left < -1 || box.right > innerWidth + 1) failures.push(`${label}: outside viewport`);
      if (node.matches('input, select')) {
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const text = node.matches('select') ? node.selectedOptions[0]?.text || '' : node.value;
        const described = (node.getAttribute('aria-describedby') || '').split(/\s+/).some((id) => {
          const description = document.getElementById(id);
          return description?.getClientRects().length && description.textContent.includes(text);
        });
        if (canvas.measureText(text).width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + (node.matches('select') ? 20 : 0) > node.clientWidth + 1 && !described) failures.push(`${label}: selected value clipped without readable description`);
        if (parseFloat(css.fontSize) * 1.2 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) > box.height + 1) failures.push(`${label}: control text height`);
        continue;
      }
      if (node.clientWidth && node.scrollWidth > node.clientWidth + 1 && !['auto', 'scroll'].includes(css.overflowX)) failures.push(`${label}: horizontal clipping`);
      if (node.clientHeight && node.scrollHeight > node.clientHeight + 1 && !['auto', 'scroll'].includes(css.overflowY)) failures.push(`${label}: vertical clipping`);
    }
    return failures;
  });
  expect(failures, 'Toolbar and disclosure must fit without depending on the table').toEqual([]);
}

async function sameRow(page, desktop = false) {
  const search = await page.getByTestId('input-search-sales-targets').boundingBox();
  const refresh = await page.getByTestId('button-refresh-sales-targets').boundingBox();
  expect(Math.abs(search.y - refresh.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(search.height - refresh.height)).toBeLessThanOrEqual(1);
  expect(refresh.x - search.x - search.width).toBeGreaterThanOrEqual(7);
  expect(refresh.x - search.x - search.width).toBeLessThanOrEqual(9);
  if (desktop) {
    expect(search.width).toBeGreaterThanOrEqual(280);
    expect(search.width).toBeLessThanOrEqual(360);
    expect(refresh.width).toBeLessThan(160);
  }
}

export function registerSalesTargetToolbar(test, fixture) {
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    test(`@sales-target-toolbar cold listing ${theme}/${appearance}: compact row, disclosure and retained filter feedback`, async ({ page }, info) => {
      test.setTimeout(120000);
      const { refs, record } = fixture();
      await page.setViewportSize({ width: 1440, height: 960 });
      await authenticateAdmin(page);
      // The first rendered protected route is Sales Target, never Doctor Master.
      await page.goto(`${process.env.EVEXIA_PREVIEW_BASE_URL}/admin/masters/sales-targets`);
      await expect(page.getByTestId('text-sales-target-count')).toBeVisible();
      await page.evaluate(async ({ theme, appearance }) => {
        const { setAdminPreference } = await import('/src/components/admin/adminPreferences.js');
        setAdminPreference('theme', theme); setAdminPreference('appearance', appearance);
      }, { theme, appearance });
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      const disclosure = page.locator('.admin-target-filter-disclosure');
      const toggle = page.getByTestId('button-toggle-sales-target-filters');
      const search = page.getByTestId('input-search-sales-targets');
      const refresh = page.getByTestId('button-refresh-sales-targets');
      const status = page.getByTestId('select-filter-sales-target-status');
      const feedback = page.getByTestId('text-sales-target-filter-feedback');
      await expect(disclosure).not.toHaveAttribute('open');
      await expect(feedback).toHaveCount(0);
      await expect(page.getByTestId(`row-sales-target-${record.id}`)).toBeVisible();
      const baselineTotal = await page.getByTestId('text-sales-target-total-total').textContent();
      await expect(page.locator('.admin-target-toolbar')).not.toContainText(/\d+ total targets/);
      const treatment = await disclosure.evaluate((node) => {
        const css = getComputedStyle(node);
        return { border: css.borderTopWidth, radius: css.borderRadius, background: css.backgroundColor };
      });
      expect(treatment.border).toBe('1px');
      expect(treatment.radius).toBe('8px');
      expect(treatment.background).not.toBe('rgba(0, 0, 0, 0)');
      await expect(toggle.locator('svg')).toHaveCount(2);
      await sameRow(page, true);

      const emptyRoute = '**/api/v1/admin/sales-targets?*';
      await page.route(emptyRoute, (route) => route.fulfill({ json: {
        items: [], total: 0, filtered: 0, totals: { q1: '0', q2: '0', q3: '0', q4: '0', total: '0' },
      } }));
      await refresh.click();
      await expect(page.getByTestId('status-sales-target-empty')).toContainText('No sales targets yet');
      await expect(feedback).toHaveCount(0);
      await expect(page.locator('.admin-target-toolbar')).not.toContainText(/\d+ total targets/);
      await sameRow(page, true);
      await page.unroute(emptyRoute);
      await refresh.click();
      await expect(page.getByTestId(`row-sales-target-${record.id}`)).toBeVisible();

      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await sameRow(page, width === 1440);
        await toolbarFits(page);
        await targetKeyboardReach(page, refresh, toggle);
        expect(await toggle.evaluate((node) => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none')).toBe(true);
        await page.keyboard.press('Enter');
        await expect(disclosure).toHaveAttribute('open', '');
        await expect(status).toBeVisible();
        await expect.poll(() => toggle.locator('svg').last().evaluate((node) => getComputedStyle(node).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
        await toolbarFits(page);
        if ([390, 1440].includes(width)) await page.locator('.admin-target-toolbar').screenshot({ path: info.outputPath(`toolbar-${width}-normal.png`) });
        await enlargeTargetText(page);
        await toolbarFits(page);
        if ([390, 1440].includes(width)) await page.locator('.admin-target-toolbar').screenshot({ path: info.outputPath(`toolbar-${width}-enlarged.png`) });
        await targetKeyboardReach(page, refresh, toggle);
        await page.keyboard.press('Space');
        await expect(disclosure).not.toHaveAttribute('open');
        await toolbarFits(page);
        await page.evaluate(() => document.getElementById('sales-target-text-enlargement')?.remove());
      }

      await search.fill('Target');
      await expect(feedback).toContainText('matching');
      await sameRow(page, true);
      await toggle.click();
      await status.selectOption('inactive');
      await expect(feedback).toContainText('unapplied changes');
      await toggle.click();
      await expect(status).toBeHidden();
      await expect(feedback).toContainText('unapplied changes');
      await sameRow(page, true);
      await refresh.click();
      await expect(refresh).toBeEnabled();
      await toggle.click();
      await expect(status).toHaveValue('inactive');
      await page.getByTestId('button-apply-sales-target-filters').click();
      await expect(page.getByTestId('status-sales-target-empty')).toBeVisible();
      await expect(feedback).toContainText('0 matching');
      await expect(feedback).not.toContainText('unapplied changes');
      await toggle.click();
      await expect(feedback).toContainText('inactive applied');
      await sameRow(page, true);
      await toggle.click();
      await page.getByTestId('button-reset-sales-target-filters').click();
      await expect(search).toHaveValue('');
      await expect(status).toHaveValue('all');
      await expect(feedback).toHaveCount(0);
      await expect(page.getByTestId(`row-sales-target-${record.id}`)).toBeVisible();
      // Earlier engines may have seeded their own rows in this same isolated
      // database. Reset must restore the full-list baseline, not one MR's sum.
      await expect(page.getByTestId('text-sales-target-total-total')).toHaveText(baselineTotal);

      // Reference/year drafts remain mounted when the disclosure is closed.
      for (const [id, query, label] of [
        ['zone', refs.zone.name, refs.zone.name],
        ['mr', refs.mr.employeeCode, `${refs.mr.name} (${refs.mr.employeeCode})`],
        ['start', '1980', '1980'], ['end', '1981', '1981'],
      ]) {
        const input = page.getByTestId(`select-filter-sales-target-${id}`);
        await input.fill(query);
        await page.getByRole('option', { name: label, exact: true }).click();
        await input.press('Tab');
      }
      await toggle.click(); await toggle.click();
      await expect(page.getByTestId('select-filter-sales-target-start')).toHaveValue('1980');
      await expect(page.getByTestId('select-filter-sales-target-end')).toHaveValue('1981');
      await expect(page.getByTestId('select-filter-sales-target-mr')).toHaveValue(`${refs.mr.name} (${refs.mr.employeeCode})`);
      await page.getByTestId('button-apply-sales-target-filters').click();
      await expect(feedback).not.toContainText('unapplied changes');
      await expect(page.getByTestId('text-sales-target-count')).toContainText('of 1');
      await expect(page.getByTestId('text-sales-target-total-total')).toHaveText('₹10,00,00,00,00,000.02');
      const zone = page.getByTestId('select-filter-sales-target-zone');
      await zone.fill(refs.otherZone.name);
      await page.getByRole('option', { name: refs.otherZone.name, exact: true }).click();
      await zone.press('Tab');
      await expect(page.getByTestId('select-filter-sales-target-mr')).toHaveValue('');
      await expect(feedback).toContainText('unapplied changes');
      await toolbarFits(page);
      await page.screenshot({ path: info.outputPath(`toolbar-${theme}-${appearance}.png`) });
    });
  }
}
