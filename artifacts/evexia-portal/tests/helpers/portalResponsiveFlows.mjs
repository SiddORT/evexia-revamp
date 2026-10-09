import { expect } from '@playwright/test';
import { representatives } from './portalResponsive.mjs';

// Read-only/cancel-only paths, with real synthetic authentication and review.
// Never commit an import, delete a record or connect a messaging provider.
export async function auditResponsiveFlows(page, browser, info, references, check, visit) {
  for (const [width, height] of representatives) {
    await page.setViewportSize({ width, height });
    await visit(page, '/admin/masters/import/allergen');
    const csv = 'Product Name,Category,Selling Price,GST,Storage Location,Concentration,Threshold limit,Status,Mix / No Mix\n' +
      `"${'Synthetic long product '.repeat(8)}",Missing category,1,5,Missing location,1:10,,active,Mix\n`;
    await page.getByTestId('input-allergen-import').setInputFiles({ name: 'synthetic-long-review.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Upload & review' }).click();
    await expect(page.getByTestId('allergen-excel-report')).toBeVisible();
    await expect(page.getByTestId('button-confirm-allergen-import')).toBeDisabled();
    await check(page, info, 'Allergen import / long invalid review');
    for (const item of await page.locator('.excel-import__row summary').all()) {
      await item.click();
    }
    await check(page, info, 'Allergen import / expanded invalid diagnostics');
    await visit(page, '/admin/masters/doctors');
    await page.getByTestId('button-toggle-doctor-filters').click();
    await check(page, info, 'Doctor / expanded filters');
    await visit(page, '/admin/masters/sales-targets');
    await page.getByTestId('button-toggle-sales-target-filters').click();
    await check(page, info, 'Sales Target / expanded filters (standard text only)');
    await visit(page, '/admin/masters/zones');
    const edit = page.getByRole('button', { name: `Edit ${references.zone.name}`, exact: true }).filter({ visible: true });
    await edit.click();
    await check(page, info, 'Zone / Edit dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const del = page.getByRole('button', { name: `Delete ${references.zone.name}`, exact: true }).filter({ visible: true });
    await del.click();
    await check(page, info, 'Zone / Delete confirmation (cancelled)');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const exportButton = page.getByRole('button', { name: 'Export data', exact: true });
    await exportButton.click(); await check(page, info, 'Zone / Export menu');
    await page.keyboard.press('Escape'); await expect(exportButton).toBeFocused();
  }
  const identities = await page.evaluate(async ({ tag, mr }) => {
    const roles = await import('/src/services/rolePermissions.js');
    const staff = await import('/src/services/staff.js');
    let role = await roles.createRole({ name: `Layout staff role ${tag}`, description: 'Synthetic responsive audit' });
    role = await roles.setRolePermissions(role.id, ['zone.add', 'zone.edit', 'zone.delete', 'zone.export', 'zone.import'], role.version);
    const made = await staff.createStaff({ name: `Layout staff ${tag}`, phone: '9876543210', dialCountry: 'IN',
      email: `layout-${tag}@example.com`, status: 'active', role: 'Staff', designation_id: (await (await import('/src/services/serverDesignations.js')).createDesignation({ name: `Layout staff designation ${tag}`, shortName: 'LS', status: 'active' })).id, dateOfJoining: '2026-01-05' });
    await staff.setStaffAccess(made.record, { customRoleId: role.id, loginEnabled: true });
    const reset = await (await import('/src/services/serverMRs.js')).resetMRPassword(mr);
    return { staff: { userId: made.record.userId, password: made.initial_password }, mr: reset.credentials };
  }, references);
  for (const role of ['staff', 'mr']) {
    const context = await browser.newContext();
    try {
      const actor = await context.newPage();
      const base = process.env.EVEXIA_PREVIEW_BASE_URL;
      await actor.goto(base + (role === 'mr' ? '/mr' : '/admin/login'));
      await actor.getByLabel('Email or username').fill(identities[role].userId);
      await actor.getByLabel('Password', { exact: true }).fill(identities[role].password);
      await actor.getByTestId('button-submit-login').click();
      await expect(actor).toHaveURL(role === 'mr' ? /\/mr\/home$/ : /\/admin\/masters\/zones$/);
      await expect(actor.getByTestId(role === 'mr' ? 'page-mr-home' : 'button-admin-profile')).toBeVisible();
      for (const [width, height] of representatives) {
        await actor.setViewportSize({ width, height });
        await check(actor, info, `${role} / authenticated home`);
        if (role === 'staff') {
          await actor.getByTestId('button-admin-profile').click();
          await check(actor, info, 'staff / profile menu'); await actor.keyboard.press('Escape');
          await actor.getByTestId('button-add-zone').click();
          await check(actor, info, 'staff / permitted Add Zone dialog');
          await actor.getByRole('button', { name: 'Cancel', exact: true }).click();
        } else {
          await actor.getByTestId('button-change-password').click();
          await expect(actor.getByRole('alert')).toBeVisible();
          await check(actor, info, 'MR / password validation (no password changed)');
        }
      }
    } finally { await context.close(); }
  }
}
