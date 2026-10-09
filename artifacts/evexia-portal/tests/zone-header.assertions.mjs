import { expect } from '@playwright/test';

export async function expectCurrentZoneHeader(page) {
  await expect(page.getByRole('heading', { name: 'Zone Master', exact: true })).toBeVisible();
  for (const label of ['Current zones', 'Deleted zones']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('[data-testid="button-zone-current"], [data-testid="button-zone-trash"], [aria-label="Zone views"]')).toHaveCount(0);
  for (const copy of [
    'Shared server records with authenticated audit history. Browser data clearing does not remove these zones.',
    'MR, Doctor, Patient and Sales Target demo assignments',
    'No local records are migrated or mirrored. Use Import data explicitly.',
    'Exports include all matches, up to 1,000 records.',
  ]) await expect(page.getByText(copy, { exact: false })).toHaveCount(0);
  await expect(page.getByTestId('input-search-zones')).toBeVisible();
  await expect(page.getByTestId('select-filter-zones')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh records', exact: true })).toBeVisible();
  await expect(page.getByTestId('text-zone-count')).toBeVisible();
  expect(await page.evaluate(() => {
    const header = document.querySelector('.admin-page-head');
    const panel = document.querySelector('[aria-label="Zone list"]');
    const gap = panel.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    return header.nextElementSibling === panel && gap >= 0 && gap <= 24
      && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
}
