import { expect } from '@playwright/test';
import { representatives } from './portalResponsive.mjs';
import { enlargePatientText } from './patientLayout.mjs';

export async function auditResponsivePanels(page, info, procurement, check, visit) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/admin/settings?tab=basic', '/admin/masters/import/allergen']) {
    await visit(page, route);
    await enlargePatientText(page, 'main');
    await check(page, info, `${route} / repaired 200% text`);
    await info.attach(`${route.includes('settings') ? 'settings' : 'import'}-390-200-percent-after`,
      { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await visit(page, '/admin/masters/opening-balances');
  await page.getByTestId('button-add-opening-balance').click();
  await check(page, info, 'Opening Balance / repaired 320px modal');
  await info.attach('opening-balance-320-after', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const [width, height] of [...representatives, [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const [route, trigger, label] of [
      ['/admin/inventory/purchase-orders', `button-preview-invoice-${procurement.po}`, 'PO invoice'],
      ['/admin/inventory/purchase-received', `button-preview-pr-${procurement.pr}`, 'Purchase Received document'],
    ]) {
      await visit(page, route);
      const opener = page.getByTestId(trigger).filter({ visible: true });
      await opener.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, info, `${label} / on-device preview`);
      const download = page.getByRole('dialog').getByRole('button', { name: 'Download PDF', exact: true });
      await download.scrollIntoViewIfNeeded();
      await expect(download).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
  for (const [width, height] of representatives) {
    await page.setViewportSize({ width, height });
    await visit(page, '/admin/settings?tab=message-templates');
    for (const channel of ['email', 'sms']) {
      await page.getByTestId(`tab-template-${channel}`).click();
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
      await check(page, info, `${channel} template / offline system preview`);
      await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
      await page.getByTestId('button-template-new').click();
      await check(page, info, `${channel} template / authoring and preview panels`);
      await page.getByTestId('button-template-save').click();
      await expect(page.locator('.mt-form [aria-invalid="true"]')).not.toHaveCount(0);
      await check(page, info, `${channel} template / validation`);
      await page.getByTestId('button-template-close').click();
    }
  }
}
