import { test, expect } from '@playwright/test';
import { seedPatientRelationships } from './helpers/patientFixture.mjs';
import { enlargePatientText } from './helpers/patientLayout.mjs';
import { auditResponsiveFlows } from './helpers/portalResponsiveFlows.mjs';
import { auditResponsivePanels } from './helpers/portalResponsivePanels.mjs';
import { representatives, expanded, publicRoutes, adminRoutes, measureLayout } from './helpers/portalResponsive.mjs';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
test.describe.configure({ mode: 'serial' });
// Also covers a WebKit project already queued before the requested scope change.
test.skip(({ browserName }) => browserName === 'webkit' && process.env.EVEXIA_RESPONSIVE_INCLUDE_WEBKIT !== '1',
  'Final WebKit recheck omitted at the user’s request; opt in explicitly to resume it.');
let records = [];
let failures = [];
test.afterEach(async ({ page }, info) => {
  await info.attach('coverage', { body: JSON.stringify({ records, failures }, null, 2), contentType: 'application/json' });
  if (info.status !== info.expectedStatus && !page.isClosed()) await info.attach('terminal-state', { body: await page.screenshot(), contentType: 'image/png' });
});

async function check(page, info, surface) {
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]));
  const measured = await measureLayout(page);
  const record = { surface, engine: info.project.name, viewport: page.viewportSize(), ...measured };
  records.push(record);
  if (measured.issues.length) {
    failures.push(record);
    await info.attach(`failure-${records.length}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  if (records.length % 50 === 0) console.log(`${info.project.name}: ${records.length} measured states, ${failures.length} failures; ${surface}`);
}
async function visit(page, route) {
  await page.goto(base() + route);
  if (route.startsWith('/admin') && route !== '/admin/login') {
    await expect(page.getByTestId('button-admin-profile')).toBeVisible();
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('main [role="status"]').filter({ hasText: /^Loading/ }).filter({ visible: true })).toHaveCount(0);
  } else await expect(page.locator('main')).toBeVisible();
}
async function tabs(page, info, route) {
  const dialog = page.getByRole('dialog');
  const root = await dialog.count() ? dialog : page.locator('main');
  const ids = await root.locator('[role="tab"], .mr-form__tab').evaluateAll((nodes) =>
    nodes.map((node) => ({ id: node.getAttribute('data-testid'), text: node.textContent })));
  for (const tab of ids) {
    const control = tab.id ? page.getByTestId(tab.id) : page.getByRole('button', { name: tab.text, exact: true });
    await control.click();
    await check(page, info, `${route} / tab: ${tab.text}`);
  }
}
test('portal route and expanded responsive audit', async ({ page, browserName, browser }, info) => {
  const focus = Boolean(process.env.EVEXIA_RESPONSIVE_SCOPE);
  if (process.env.EVEXIA_ISOLATED_AUTH_PREVIEW !== '1') throw new Error('Use the private authenticated harness.');
  records = []; failures = [];
  await info.attach('engine', { body: `${browserName} ${browser.version()} — CSS viewport emulation, not a physical device or native Safari`, contentType: 'text/plain' });
  const full = browserName === 'chromium';
  for (const route of focus ? [] : full ? publicRoutes : ['/', '/admin/login']) {
    await visit(page, route);
    for (const [width, height] of full ? expanded : representatives.slice(0, 3)) {
      await page.setViewportSize({ width, height });
      await check(page, info, route);
    }
  }
  const references = await seedPatientRelationships(page);
  const extra = await page.evaluate(async ({ doctor, tag }) => {
    const category = await (await import('/src/services/serverProductCategories.js')).createProductCategory({ name: `Layout category ${tag}`, description: 'Synthetic long description '.repeat(8), unit_price: '12.34', status: 'active' });
    const location = await (await import('/src/services/serverLocations.js')).createLocation({ name: `Layout storage ${tag}`, address: 'Synthetic laboratory address '.repeat(8), status: 'active' });
    const allergen = await (await import('/src/services/serverAllergens.js')).createAllergen({ name: `Layout allergen ${tag}`, category_id: category.id, storage_location_id: location.id, selling_price: '12.34', gst: '18', concentration: '1:10', threshold_limit: '5', status: 'active', mix: false });
    const balance = await (await import('/src/services/serverOpeningBalances.js')).createOpeningBalance({ startYear: 2025, endYear: 2026, doctorId: doctor.id, amount: '-12345.67', status: 'active' });
    const patient = await (await import('/src/services/serverPatients.js')).createPatient({ name: `Layout patient ${tag}`, gender: 'prefer not to say', phone: '123456789', dialCountry: 'AE', email: 'synthetic@example.com', dateOfBirth: '2000-02-29', doctorId: doctor.id, instructionsLanguage: 'Hindi', status: 'active', addressLine1: 'Synthetic address '.repeat(10), addressLine2: '', landmark: 'Landmark', pincode: '110001', country: 'India', state: 'Delhi', city: 'Delhi' });
    const hq = await (await import('/src/services/serverHeadquarters.js')).createHeadquarter({ name: `Layout headquarters ${tag}`, state_code: `L${tag}`.toUpperCase(), status: 'active' });
    const designation = await (await import('/src/services/serverDesignations.js')).createDesignation({ name: `Layout designation ${tag}`, shortName: 'LAYOUT', level: 1, status: 'active' });
    return { category, location, allergen, balance, patient, hq, designation };
  }, references);
  const edits = [
    `/admin/masters/mrs/${references.mr.id}`, `/admin/masters/doctors/${references.doctor.id}`,
    `/admin/masters/doctors/${references.doctor.id}/payments`,
    `/admin/masters/product-categories/${extra.category.id}`, `/admin/masters/storage-locations/${extra.location.id}`,
    `/admin/masters/allergens/${extra.allergen.id}`, `/admin/masters/opening-balances/${extra.balance.id}`,
    `/admin/masters/patients/${extra.patient.id}`, `/admin/masters/patients/${extra.patient.id}/dosage-history`,
    `/admin/masters/headquarters/${extra.hq.id}`, `/admin/masters/designations/${extra.designation.id}`,
  ];
  const highRisk = ['/admin/masters/allergens', '/admin/masters/doctors/new', '/admin/masters/import/allergen',
    '/admin/masters/opening-balances', '/admin/settings?tab=communication', '/admin/activity-logs', '/admin/inventory/purchase-orders/new',
    '/admin/orders/spt', '/admin/orders/spt/new'];
  if (process.env.EVEXIA_RESPONSIVE_SCOPE === 'table') {
    for (const route of ['/admin/masters/mrs', '/admin/masters/doctors']) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await visit(page, route); await check(page, info, `${route} / table diagnosis`);
    }
    expect(failures, JSON.stringify(failures)).toEqual([]);
    return;
  }
  await visit(page, '/admin/inventory/purchase-orders');
  // PO samples initialize in the new browser context. Never reset a store.
  await visit(page, '/admin/inventory/purchase-received');
  await page.getByTestId('button-sample-purchase-received').click();
  await expect(page.getByText('Sample', { exact: true }).first()).toBeVisible();
  const procurement = await page.evaluate(async () => {
    const po = (await import('/src/services/purchaseOrders.js')).loadPOSnapshot();
    const pr = (await import('/src/services/purchaseReceived.js')).loadPRSnapshot();
    return { po: po.record.orders[0]?.id, pr: pr.record.receipts[0]?.id };
  });
  if (!procurement.po || !procurement.pr) throw new Error('Sample procurement fixtures unavailable.');
  if (process.env.EVEXIA_RESPONSIVE_SCOPE === 'panels') {
    await auditResponsivePanels(page, info, procurement, check, visit);
    await info.attach('representative-final', { body: await page.screenshot(), contentType: 'image/png' });
    expect(failures, JSON.stringify(failures)).toEqual([]);
    return;
  }
  edits.push(`/admin/inventory/purchase-orders/${procurement.po}`, `/admin/inventory/purchase-received/${procurement.pr}`);
  for (const route of focus ? ['/admin/masters/mrs', '/admin/masters/doctors'] : full ? [...adminRoutes, ...edits] : highRisk) {
    for (const [width, height] of full ? representatives : representatives.slice(0, 3)) {
      await page.setViewportSize({ width, height });
      await visit(page, route);
      await check(page, info, route);
      await tabs(page, info, route);
    }
  }
  for (const route of focus ? [] : highRisk) {
    await visit(page, route);
    for (const [width, height] of full ? expanded : [[320, 568], [844, 390], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await check(page, info, `${route} / expanded`);
    }
  }
  for (const [route, trigger] of [
    ['/admin/masters/zones', 'button-add-zone'],
    ['/admin/masters/courier-partners', 'button-add-courier-partner'],
    ['/admin/masters/vendors', 'button-add-vendor'],
    ['/admin/masters/sales-targets', 'button-add-sales-target'],
    ['/admin/staff', 'button-add-staff'],
    ['/admin/roles-permissions', 'button-add-role'],
    ['/admin/settings?tab=communication', 'button-add-communication'],
    ['/admin/settings?tab=message-templates', 'button-template-new'],
  ]) {
    for (const [width, height] of representatives) {
      await page.setViewportSize({ width, height }); await visit(page, route);
      await page.getByTestId(trigger).click();
      await check(page, info, `${route} / Add editor`);
      if (await page.getByRole('dialog').count()) await tabs(page, info, `${route} / Add editor`);
      const cancel = page.getByRole('button', { name: /^(Cancel|Close)$/ }).filter({ visible: true }).last();
      await cancel.scrollIntoViewIfNeeded(); await cancel.click();
    }
  }
  for (const [width, height] of [[320, 568], [844, 390], [820, 1180], [1366, 768]]) {
    await page.setViewportSize({ width, height });
    await visit(page, '/admin/masters/opening-balances');
    if (width <= 900) {
      await page.getByTestId('button-open-navigation').click();
      await expect(page.getByTestId('input-search-navigation')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('.admin-sidebar')).toContainText('Workspace');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('button-open-navigation')).toBeFocused();
    }
    await page.getByTestId('button-admin-profile').click();
    await check(page, info, 'profile menu');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('button-admin-profile')).toBeFocused();
    await page.getByTestId('button-add-opening-balance').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await check(page, info, 'Opening Balance modal');
    await page.getByTestId('button-save-opening-balance').click();
    await expect(page.getByRole('dialog').locator('[role="alert"]').first()).toBeVisible();
    await check(page, info, 'Opening Balance modal validation');
    await page.getByRole('combobox', { name: 'Financial start year' }).click();
    await check(page, info, 'Opening Balance selector');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.scrollIntoViewIfNeeded(); await cancel.click();
    await expect(page.getByTestId('button-add-opening-balance')).toBeFocused();
  }
  for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      localStorage.setItem('evexia.admin.theme', theme); localStorage.setItem('evexia.admin.appearance', appearance);
    }, { theme, appearance });
    for (const [width, height] of representatives.slice(0, 3)) {
      await page.setViewportSize({ width, height });
      for (const route of ['/admin/settings?tab=basic', '/admin/masters/import/allergen', '/admin/masters/opening-balances/new']) {
        await visit(page, route);
        await check(page, info, `${route} / ${theme} ${appearance}`);
        await enlargePatientText(page, 'main');
        await check(page, info, `${route} / ${theme} ${appearance} / 200% computed text`);
      }
    }
  }
  if (full) {
    await page.setViewportSize({ width: 683, height: 384 });
    await visit(page, '/admin/masters/opening-balances');
    await check(page, info, '1366×768 at 200% effective-viewport reflow (not native browser UI zoom)');
  }
  await auditResponsiveFlows(page, browser, info, references, check, visit);
  await info.attach('representative-final', { body: await page.screenshot(), contentType: 'image/png' });
  expect(failures, JSON.stringify(failures.map(({ surface, viewport, issues }) => ({ surface, viewport, issues })))).toEqual([]);
});
