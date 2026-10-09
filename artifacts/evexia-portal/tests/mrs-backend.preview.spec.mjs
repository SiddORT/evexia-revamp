import { test, expect } from '@playwright/test';
test.use({ hasTouch: true });
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const path = '/admin/masters/mrs';
const key = 'evexia.admin.mrs.v1';
const legacy = '[{"id":"local-mr-kept","name":"Legacy MR remains local","userId":"legacy-mr-local","status":"active"}]';
async function signIn(page, portal = '/admin/login', username = 'crm-admin@allergyevexia.in', password = process.env.EVEXIA_TEST_ADMIN_PASSWORD) {
  await page.goto(base() + portal);
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId(portal === '/mr' ? 'page-mr-home' : 'button-admin-profile')).toBeVisible();
}
async function directory(page, label) {
  await signIn(page);
  const refs = await page.evaluate(async (label) => {
    const session = await import('/src/auth/adminSession.js');
    const hq = await session.headquarterRequest('', { body: { name: `MR ${label} HQ`, status: 'active' } });
    const zone = await session.zoneRequest('', { body: { name: `MR ${label} Zone`, status: 'active' } });
    if (label === 'Desktop') {
      const file = new File([`Designation Name,Short Name,Status\n${Array.from({ length: 101 }, (_, n) => `AA Paged MR Designation ${String(n).padStart(3, '0')},MR,active`).join('\n')}`], 'paged-designations.csv', { type: 'text/csv' });
      const review = await session.designationRequest('/import/review', { file, params: { filename: file.name } });
      if (!review.valid) throw new Error('Synthetic designation fixture review failed');
      await session.designationRequest('/import/commit', { file, params: { filename: file.name, digest: review.digest, confirm: true } });
    }
    const designation = await session.designationRequest('', { body: { name: `MR ${label} Designation`, shortName: 'MR', status: 'active' } });
    return { hq: hq.id, zone: zone.id, designation: designation.id };
  }, label);
  await page.evaluate(({ key, legacy }) => localStorage.setItem(key, legacy), { key, legacy });
  await page.goto(base() + path);
  await expect(page.getByTestId('text-mr-count')).toBeVisible();
  return refs;
}
async function discard(page) {
  await page.getByTestId('checkbox-credentials-saved').check();
  await page.getByTestId('button-close-credentials').click();
  await expect(page.getByTestId('panel-mr-credentials')).toHaveCount(0);
}
async function filter(page, id, name) {
  await page.getByTestId(`select-${id}`).click();
  await page.getByRole('option', { name, exact: true }).click();
}
for (const mobile of [false, true]) {
  test(`MR ${mobile ? 'mobile' : 'desktop'} full form, PIN, persistence, one-time password and real MR home`, async ({ page }, info) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const label = mobile ? 'Mobile' : 'Desktop';
    const refs = await directory(page, label);
    let failDesignation = true;
    await page.route('**/api/v1/admin/mrs/references*', (route) => {
      if (new URL(route.request().url()).searchParams.get('kind') === 'designations' && failDesignation) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic reference failure' }) });
      }
      return route.continue();
    });
    await expect(page.getByText('Legacy MR remains local', { exact: true })).toHaveCount(0);
    await page.getByTestId('button-add-mr').click();
    await page.getByTestId('select-mr-contactRequirement').selectOption('optional');
    await page.getByTestId('input-mr-name').fill(`Synthetic ${label} MR`);
    await page.getByTestId('button-generate-mr-user-id').click();
    await expect(page.getByTestId('input-mr-userId')).toHaveValue(/^mr\.[a-f0-9]+$/);
    const username = await page.getByTestId('input-mr-userId').inputValue();
    await page.getByTestId('tab-mr-assignment').click();
    await filter(page, 'mr-headquarters', `MR ${label} HQ`);
    await filter(page, 'mr-zones', `MR ${label} Zone`);
    await page.getByTestId('input-mr-employeeCode').fill(`MR-${label}`);
    await page.getByTestId('input-mr-dateOfJoining').fill('2020-01-01');
    await page.getByTestId('select-mr-designations').click();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    failDesignation = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByTestId('select-mr-designations')).not.toHaveAttribute('aria-busy', 'true');
    if (!mobile) {
      await expect(page.getByRole('option', { name: `MR ${label} Designation`, exact: true })).toHaveCount(0);
      await page.getByTestId('button-more-mr-designations').click();
    } else {
      await page.getByTestId('select-mr-designations').fill(`MR ${label} Designation`);
    }
    await expect(page.getByRole('option', { name: `MR ${label} Designation`, exact: true })).toBeVisible();
    await page.getByTestId('button-save-mr').click();
    await expect(page.getByTestId('select-mr-designations')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('select-mr-designations')).toBeFocused();
    await page.getByTestId('select-mr-designations').fill(`MR ${label} Designation`);
    await page.getByRole('option', { name: `MR ${label} Designation`, exact: true }).click();
    await page.getByTestId('input-mr-paymentLimit').fill('123.45');
    await page.getByTestId('input-mr-doctorDaysLimit').fill('12');
    await page.screenshot({ path: info.outputPath(`mr-${label.toLowerCase()}-assignment.png`), fullPage: true });
    await page.getByTestId('tab-mr-address').click();
    await page.route('**/api/v1/admin/mrs/postal/110001*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ pincode: '110001', choices: [{ city: 'District suggestion', state: 'Delhi', country: 'India' }], message: '' }),
    }));
    await page.getByTestId('input-mr-pincode').fill('110001');
    await expect(page.getByTestId('input-mr-city')).toHaveValue('District suggestion');
    await page.getByTestId('input-mr-city').fill('Manual city');
    await page.route('**/api/v1/admin/mrs/postal/110002*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ pincode: '110002', choices: [
        { city: 'Choice A', state: 'Delhi', country: 'India' }, { city: 'Choice B', state: 'Delhi', country: 'India' },
      ], message: '' }),
    }));
    await page.getByTestId('input-mr-pincode').fill('110002');
    await page.getByTestId('button-postal-choice-1').click();
    await expect(page.getByTestId('input-mr-city')).toHaveValue('Manual city');
    await page.route('**/api/v1/admin/mrs/postal/110003*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ pincode: '110003', choices: [], message: 'Provider unavailable. Enter manually.' }),
    }));
    await page.getByTestId('input-mr-pincode').fill('110003');
    await expect(page.getByTestId('status-mr-postal')).toContainText('Enter manually');
    await expect(page.getByTestId('input-mr-city')).toHaveValue('Manual city');
    await page.getByTestId('input-mr-addressLine1').fill('Synthetic street');
    await page.getByTestId('input-mr-addressLine2').fill('Synthetic line 2');
    await page.getByTestId('input-mr-landmark').fill('Synthetic landmark');
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/mrs' && r.request().method() === 'POST');
    await page.getByTestId('button-save-mr').click();
    const saved = await (await response).json();
    expect(saved.record.city).toBe('Manual city');
    expect(saved.record.hq).toBe(refs.hq);
    expect(saved.record.zoneId).toBe(refs.zone);
    expect(saved.record.reportingManagerId).toBeNull();
    expect(saved.record.status).toBe('active');
    expect(saved.record.designation_id).toBe(refs.designation);
    expect(saved.record.designationName).toBe(`MR ${label} Designation`);
    expect(saved.record.designation).toBeUndefined();
    expect(saved.credentials.userId).toBe(username);
    await expect(page.getByTestId('button-close-credentials')).toBeDisabled();
    await page.getByTestId('button-toggle-credentials').click();
    await expect(page.getByTestId(`text-credential-${username}`)).toHaveText(saved.credentials.password);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain(saved.credentials.password);
    await discard(page);
    await page.evaluate(async ({ id, name }) => {
      const s = await import('/src/auth/adminSession.js');
      await s.designationRequest(`/${id}/edit`, { body: { name, shortName: 'MR', status: 'inactive', expected_version: 1 } });
    }, { id: refs.designation, name: `Renamed ${label} Designation` });
    await expect(page.getByTestId('text-mr-count')).toBeVisible();
    const record = page.locator(mobile ? 'article[role=listitem]' : 'tbody tr').filter({ hasText: `Synthetic ${label} MR` });
    await expect(record).toContainText('Super Admin');
    await record.getByTestId(`button-doctors-mr-${saved.record.id}`).click();
    await expect(page.getByTestId('text-mr-doctor-count')).toContainText('0 live assigned doctors');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(legacy);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('text-mr-count')).toBeVisible();
    await expect(record).toContainText(`Synthetic ${label} MR`);
    await record.getByTestId(`button-edit-mr-${saved.record.id}`).click();
    await expect(page.getByTestId('input-mr-password')).toHaveCount(0);
    await page.getByTestId('input-mr-name').fill(`Synthetic ${label} MR Edited`);
    await page.evaluate(async () => (await import('/src/auth/adminSession.js')).verifySession(true));
    await expect(page.getByTestId('input-mr-name')).toHaveValue(`Synthetic ${label} MR Edited`);
    await page.getByTestId('tab-mr-assignment').click();
    await expect(page.getByTestId('select-mr-zones')).toHaveValue(`MR ${label} Zone`);
    await expect(page.getByTestId('select-mr-headquarters')).toHaveValue(`MR ${label} HQ`);
    await expect(page.getByTestId('select-mr-designations')).toHaveValue(`Renamed ${label} Designation (inactive)`);
    await expect(page.getByText('Designation is inactive. You may retain the saved assignment.')).toBeVisible();
    await expect(page.getByTestId('select-mr-managers')).not.toHaveAttribute('aria-busy', 'true');
    await page.getByTestId('select-mr-managers').click();
    await expect(page.getByTestId('select-mr-managers')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('option', { name: `Synthetic ${label} MR`, exact: true })).toHaveCount(0);
    await page.getByTestId('select-mr-managers').press('Escape');
    await page.getByTestId('button-save-mr').click();
    await expect(page.getByTestId('text-mr-count')).toBeVisible();
    await expect(record).toContainText(`Renamed ${label} Designation`);
    await filter(page, 'mr-zone-filter', `MR ${label} Zone`);
    await filter(page, 'mr-hq-filter', `MR ${label} HQ`);
    await filter(page, 'mr-status-filter', 'Active');
    await page.getByTestId('input-search-mrs').fill(username);
    await expect(page.getByTestId('text-mr-count')).toContainText('of 1');
    await page.screenshot({ path: info.outputPath(`mr-${label.toLowerCase()}-directory.png`), fullPage: true });
    await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
    await signIn(page, '/mr', username, saved.credentials.password);
    await expect(page.getByTestId('text-mr-account')).toContainText(username);
    await page.reload();
    await expect(page.getByTestId('page-mr-home')).toBeVisible();
    await page.getByLabel('Current password', { exact: true }).fill(saved.credentials.password);
    await page.getByLabel('New password (12 to 128 characters)').fill(`Synthetic-${label}-changed-password`);
    await page.getByLabel('Confirm new password', { exact: true }).fill(`Synthetic-${label}-changed-password`);
    await page.getByTestId('button-change-password').click();
    await expect(page.getByTestId('form-login-mr')).toBeVisible();
    await signIn(page, '/mr', username, `Synthetic-${label}-changed-password`);
    await page.getByTestId('button-mr-signout').click();
    await expect(page.getByTestId('form-login-mr')).toBeVisible();
  });
}
test('MR import review/confirm, genuine samples, reset and deactivation', async ({ page }, info) => {
  test.setTimeout(90000);
  const refs = await directory(page, 'Transfer');
  await page.getByTestId('button-import-mrs').click();
  await expect(page.getByTestId('input-mr-import')).toBeVisible();
  const sampleDownload = page.waitForEvent('download');
  await page.getByTestId('button-sample-mr-xlsx').click();
  const sample = await sampleDownload;
  expect(sample.suggestedFilename()).toMatch(/\.xlsx$/);
  const headers = 'Employee Code,MR Name,Phone No.,User ID,Email ID,Contact Requirement,HQ,Assigned Zone,Date of Joining,Designation,Reporting Manager,Payment Limit,Doctor Days Limit,Status,Address Line 1,Address Line 2,Landmark,Pincode,City,State,Country';
  const csv = `${headers}\nMR-Transfer,Synthetic Transfer MR,,synthetic.transfer,,optional,MR Transfer HQ,MR Transfer Zone,2020-01-01,MR Transfer Designation,,0.00,0,active,Synthetic street,,Landmark,110001,Delhi,Delhi,India\n`;
  await page.getByTestId('input-mr-import').setInputFiles({ name: 'synthetic-mrs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByTestId('button-review-mr-import').click();
  await expect(page.getByTestId('button-confirm-mr-import')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('mr-import-review.png'), fullPage: true });
  const committed = page.waitForResponse((r) => r.url().includes('/mrs/import/commit'));
  await page.getByTestId('button-confirm-mr-import').click();
  const result = await (await committed).json();
  expect(result.imported).toBe(1);
  await discard(page);
  await page.goto(base() + path);
  await expect(page.getByTestId('text-mr-count')).toBeVisible();
  await filter(page, 'mr-zone-filter', 'MR Transfer Zone');
  await filter(page, 'mr-hq-filter', 'MR Transfer HQ');
  const row = await page.evaluate(async (username) => (await import('/src/services/serverMRs.js')).resolveMRAccount(username), 'synthetic.transfer');
  await page.locator(`[data-testid="button-reset-mr-${row.id}"]:visible`).click();
  const resetResponse = page.waitForResponse((r) => r.url().includes('/reset'));
  await page.getByTestId('button-confirm-action').click();
  const reset = await (await resetResponse).json();
  expect(reset.credentials.password).not.toBe(result.credentials[0].password);
  await discard(page);
  await page.locator(`[data-testid="button-toggle-mr-${row.id}"]:visible`).click();
  await page.getByTestId('button-confirm-action').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await filter(page, 'mr-status-filter', 'Inactive');
  await expect(page.getByTestId('text-mr-count')).toContainText('of 1');
  await page.getByTestId('button-export-mrs').click();
  const exported = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)' }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.xlsx$/);
});

test('MR deleted designation must be replaced without changing the account', async ({ page }) => {
  const refs = await directory(page, 'Replacement');
  const record = await page.evaluate(async (refs) => {
    const s = await import('/src/auth/adminSession.js');
    const created = await s.mrRequest('', { body: {
      name: 'Synthetic replacement MR', employeeCode: 'REPLACE-MR', userId: 'replace.mr',
      phone: '', email: '', contactRequirement: 'optional', hq: refs.hq, zoneId: refs.zone,
      dateOfJoining: '2020-01-01', designation_id: refs.designation, reportingManagerId: null,
      paymentLimit: '0.00', doctorDaysLimit: 0, status: 'active', pincode: '110001',
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark',
      city: 'Delhi', state: 'Delhi', country: 'India',
    } });
    await s.designationRequest(`/${refs.designation}/delete`, { body: { expected_version: 1 } });
    return created.record;
  }, refs);
  await page.reload();
  const recordRow = page.locator('tbody tr').filter({ hasText: 'Synthetic replacement MR' });
  await expect(recordRow.getByTestId(`button-edit-mr-${record.id}`)).toBeVisible();
  await recordRow.getByTestId(`button-edit-mr-${record.id}`).click();
  await page.getByTestId('tab-mr-assignment').click();
  const control = page.getByTestId('select-mr-designations');
  await expect(control).toHaveValue('MR Replacement Designation (deleted)');
  await control.click();
  await expect(page.getByRole('option', { name: 'MR Replacement Designation (deleted)', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await control.press('Escape');
  await expect(page.getByText('Designation was deleted. Explicitly replace it before saving.')).toBeVisible();
  await page.getByTestId('button-save-mr').click();
  await expect(page.getByText('Designation is missing or deleted. Explicitly select an active catalogue designation.')).toBeVisible();
  // Keep the existing conflict/reconciliation boundary; rejection is not
  // permission to silently replay a later write from the same stale form.
  await page.getByTestId('button-reconcile-mr').click();
  await expect(page.getByText('Latest saved version loaded. Review it before saving again.')).toBeVisible();
  await page.getByTestId('tab-mr-assignment').click();
  const replacement = await page.evaluate(async () => (await import('/src/auth/adminSession.js')).designationRequest('', {
    body: { name: 'ZZ Replacement designation', shortName: 'MR', status: 'active' },
  }));
  await control.fill('ZZ Replacement designation');
  await page.getByRole('option', { name: 'ZZ Replacement designation', exact: true }).click();
  const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/mrs/${record.id}/edit`));
  await page.getByTestId('button-save-mr').click();
  const saved = await (await response).json();
  expect(saved.id).toBe(record.id);
  expect(saved.userId).toBe(record.userId);
  expect(saved.designation_id).toBe(replacement.id);
  expect(saved.designationName).toBe(replacement.name);
  await expect(page.getByTestId('text-mr-count')).toBeVisible();
});

test('MR assignment comboboxes: selected IDs, manager clearing, stale responses, paging retry and layouts', async ({ page }, info) => {
  test.setTimeout(120000);
  const refs = await directory(page, 'Assignments');
  const records = await page.evaluate(async (refs) => {
    const s = await import('/src/auth/adminSession.js');
    const body = {
      name: 'Assignment manager', employeeCode: 'ASSIGN-MANAGER', userId: 'assignment.manager',
      phone: '', email: '', contactRequirement: 'optional', hq: refs.hq, zoneId: refs.zone,
      dateOfJoining: '2020-01-01', designation_id: refs.designation, reportingManagerId: null,
      paymentLimit: '0.00', doctorDaysLimit: 0, status: 'active', pincode: '110001',
      addressLine1: 'Synthetic street', addressLine2: '', landmark: 'Landmark',
      city: 'Delhi', state: 'Delhi', country: 'India',
    };
    const manager = (await s.mrRequest('', { body })).record;
    const mr = (await s.mrRequest('', { body: { ...body, name: 'Assignment worker',
      employeeCode: 'ASSIGN-WORKER', userId: 'assignment.worker', reportingManagerId: manager.id } })).record;
    return { mr, manager };
  }, refs);
  await page.goto(base() + path + '/' + records.mr.id);
  await page.getByTestId('tab-mr-assignment').click();
  const zone = page.getByTestId('select-mr-zones');
  const manager = page.getByTestId('select-mr-managers');
  const status = page.getByTestId('select-mr-status');
  await expect(manager).toHaveValue('Assignment manager');
  await expect(page.locator('#mr-panel-assignment input[role=combobox]')).toHaveCount(5);
  await expect(page.locator('#mr-panel-assignment select')).toHaveCount(0);
  await expect(page.locator('[data-testid^="input-search-mr-"]')).toHaveCount(0);
  await expect(page.getByText(/^Showing up to/)).toHaveCount(0);
  await manager.click();
  await expect(manager).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('option', { name: 'Assignment worker', exact: true })).toHaveCount(0);
  await manager.fill('missing manager');
  await expect(page.getByText('No matches found.', { exact: true })).toBeVisible();
  await manager.press('Escape');
  await expect(manager).toHaveValue('Assignment manager');
  await filter(page, 'mr-managers', 'No reporting manager');
  await expect(manager).toHaveValue('');
  await status.click(); await status.fill('inactive'); await status.press('ArrowDown'); await status.press('Enter');
  await expect(status).toHaveValue('Inactive');
  const savedResponse = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/mrs/${records.mr.id}/edit`));
  await page.getByTestId('button-save-mr').click();
  const saved = await (await savedResponse).json();
  expect(saved.reportingManagerId).toBeNull(); expect(saved.status).toBe('inactive');
  expect(saved.hq).toBe(refs.hq); expect(saved.zoneId).toBe(refs.zone);
  expect(saved.designation_id).toBe(refs.designation);
  await expect(page.getByTestId('text-mr-count')).toBeVisible();
  await page.goto(base() + path + '/' + records.mr.id);
  await page.getByTestId('tab-mr-assignment').click();
  await expect(manager).toHaveValue(''); await expect(status).toHaveValue('Inactive');
  await expect(zone).toHaveValue('MR Assignments Zone');

  let mode = 'empty', held = false, release, finished;
  let failMore = true;
  await page.route('**/api/v1/admin/mrs/references*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('kind') !== 'zones') return route.continue();
    const q = params.get('query') || '';
    const offset = Number(params.get('offset'));
    if (mode === 'error' || (mode === 'more' && offset && failMore)) {
      if (mode === 'more') failMore = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic reference failure' }) });
    }
    if ((mode === 'late' && q === 'old') || mode === 'held') {
      held = true; await new Promise((resolve) => { release = resolve; });
    }
    const items = mode === 'late' ? [{ id: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', name: q === 'old' ? 'Old late assignment' : 'New current assignment', status: 'active' }]
      : mode === 'more' ? offset ? [{ id: refs.zone, name: 'Final paged zone', status: 'active' }]
        : Array.from({ length: 100 }, (_, n) => ({ id: `synthetic-${n}`, name: `Choice ${n}`, status: 'active' })) : [];
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ items, total: mode === 'more' ? 101 : items.length, limit: 100, offset }) }).catch(() => {});
    finished?.();
  });
  await zone.click();
  await expect(page.getByText('No zones exist yet. Add one in Zone Master first.', { exact: true })).toBeVisible();
  await zone.fill('missing'); await expect(page.getByText('No matches found.', { exact: true })).toBeVisible();
  mode = 'error'; await zone.fill('failure');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await zone.press('Tab'); await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
  mode = 'empty'; await page.keyboard.press('Enter');
  await expect(zone).toBeFocused();
  await expect(page.getByText('No matches found.', { exact: true })).toBeVisible();
  mode = 'late'; await zone.fill('old'); await expect.poll(() => held).toBe(true);
  await zone.fill('new'); await expect(page.getByRole('option', { name: 'New current assignment', exact: true })).toBeVisible();
  const done = new Promise((resolve) => { finished = resolve; }); release(); await done; finished = null;
  await expect(page.getByRole('option', { name: 'Old late assignment', exact: true })).toHaveCount(0);
  await zone.press('Escape'); await expect(zone).toHaveValue('MR Assignments Zone');
  mode = 'more'; await zone.click();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.getByRole('button', { name: 'Retry load more', exact: true }).click();
  await expect(zone).toBeFocused();
  await page.getByRole('option', { name: 'Final paged zone', exact: true }).click();
  await expect(zone).toHaveValue('Final paged zone');
  await zone.fill('not chosen'); await zone.press('Escape');
  await expect(zone).toHaveValue('Final paged zone');

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(async (appearance) => (await import('/src/components/admin/adminPreferences.js')).setAdminPreference('appearance', appearance), appearance);
      const heights = await page.locator('#mr-panel-assignment .mr-form-combobox__control, #mr-panel-assignment .mr-form__control')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
      expect(heights).toHaveLength(9); for (const height of heights) expect(height).toBe(42);
      const grid = await page.locator('#mr-panel-assignment .mr-form__grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
      expect(grid).toBe(width === 390 ? 1 : 2);
      await status.click();
      const menu = page.locator('.mr-form-combobox__menu');
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
      const style = await menu.evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
      expect(style.bg).not.toBe('rgba(0, 0, 0, 0)'); expect(style.bg).not.toBe(style.color);
      await page.screenshot({ path: info.outputPath(`mr-assignment-${width}-${appearance}.png`), fullPage: true });
      await status.press('Escape');
    }
  }
  // Owner/unmount cleanup must not apply a response to another session.
  mode = 'held'; held = false; await zone.click(); await expect.poll(() => held).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Loading choices' })).toBeVisible();
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  const closed = new Promise((resolve) => { finished = resolve; }); release(); await closed;
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('MR compact server filters: paging, query isolation, feedback, keyboard, touch and themed exports', async ({ page }, info) => {
  test.setTimeout(120000);
  await directory(page, 'Filters');
  // Real authenticated references beyond the first 100 results, not a local
  // client-filtered substitute. The fixture uses a private synthetic database.
  await page.evaluate(async () => {
    const session = await import('/src/auth/adminSession.js');
    for (let n = 0; n < 105; n++) {
      await session.zoneRequest('', { body: { name: `Paged zone ${String(n).padStart(3, '0')}`, status: n === 104 ? 'inactive' : 'active' } });
    }
  });
  const zone = page.getByTestId('select-mr-zone-filter');
  const hq = page.getByTestId('select-mr-hq-filter');
  const status = page.getByTestId('select-mr-status-filter');
  await zone.click();
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  const appliedResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/admin/mrs' && new URL(r.url()).searchParams.has('zone_id'));
  await page.getByRole('option', { name: 'Paged zone 104 (inactive)', exact: true }).click();
  await expect(zone).toHaveValue('Paged zone 104 (inactive)');
  const applied = new URL((await appliedResponse).url()).searchParams.get('zone_id');
  const requests = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/v1/admin/mrs') requests.push(new URL(r.url())); });
  await zone.click();
  await zone.fill('Paged zone 000');
  await expect(page.getByRole('option', { name: 'Paged zone 000', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await zone.press('Escape');
  await expect(zone).toHaveValue('Paged zone 104 (inactive)');
  await hq.click();
  await hq.fill('MR Filters HQ');
  await page.getByRole('option', { name: 'MR Filters HQ', exact: true }).click();
  await status.click();
  await status.fill('inactive');
  await status.press('ArrowDown'); // Explicit All entry.
  await status.press('ArrowDown');
  await status.press('Enter');
  await expect(status).toHaveValue('Inactive');
  await page.getByTestId('input-search-mrs').fill('Synthetic');
  await expect.poll(() => requests.at(-1)?.searchParams.get('query')).toBe('Synthetic');
  await expect(page.getByTestId('text-mr-count')).toBeVisible();
  const listParams = requests.at(-1).searchParams;
  expect(listParams.get('zone_id')).toBe(applied);
  expect(listParams.get('status')).toBe('inactive');
  expect(listParams.get('offset')).toBe('0');
  for (const appearance of ['light', 'dark']) {
    await page.evaluate(async (appearance) => {
      const prefs = await import('/src/components/admin/adminPreferences.js');
      prefs.setAdminPreference('appearance', appearance);
    }, appearance);
    await page.getByTestId('button-export-mrs').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const style = await menu.evaluate((node) => {
      const css = getComputedStyle(node);
      return { bg: css.backgroundColor, border: css.borderTopWidth, shadow: css.boxShadow, padding: css.paddingTop, color: getComputedStyle(node.querySelector('[role=menuitem]')).color, z: css.zIndex };
    });
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.bg).not.toBe('transparent');
    expect(style.border).toBe('1px'); expect(style.shadow).not.toBe('none');
    expect(parseFloat(style.padding)).toBeGreaterThan(0); expect(Number(style.z)).toBeGreaterThan(30);
    expect(style.color).not.toBe(style.bg);
    await page.screenshot({ path: info.outputPath(`mr-export-${appearance}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('button-export-mrs')).toBeFocused();
    for (const [format, name] of [['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)']]) {
      await page.getByTestId('button-export-mrs').click();
      const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/mrs/export'));
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name, exact: true }).click();
      const params = new URL((await response).url()).searchParams;
      for (const key of ['zone_id', 'hq_id', 'query', 'status']) expect(params.get(key)).toBe(listParams.get(key));
      expect((await download).suggestedFilename()).toBe(`evexia-mr-master.${format}`);
    }
  }
  await filter(page, 'mr-zone-filter', 'All zones');
  await filter(page, 'mr-hq-filter', 'All headquarters');
  await filter(page, 'mr-status-filter', 'All statuses');
  await expect(zone).toHaveValue('All zones');
  await expect(hq).toHaveValue('All headquarters');
  await expect(status).toHaveValue('All statuses');
  await page.getByTestId('input-search-mrs').fill('');
  await expect.poll(() => requests.at(-1)?.searchParams.has('query')).toBe(false);
  await expect(page.getByTestId('text-mr-count')).toBeVisible();

  await page.route('**/api/v1/admin/mrs?*', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ items: [], total: 25, filtered: 25 }),
  }));
  await page.getByTestId('button-refresh-mrs').click();
  await page.getByRole('button', { name: 'Go to page 2', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('offset')).toBe('10');
  await filter(page, 'mr-status-filter', 'Active');
  await expect.poll(() => requests.at(-1)?.searchParams.get('offset')).toBe('0');
  await page.unroute('**/api/v1/admin/mrs?*');

  // Controlled transport states exercise the real authenticated caller.
  let mode = 'loading', held;
  let failMore = true;
  let release;
  await page.route('**/api/v1/admin/mrs/references*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('kind') !== 'zones') return route.continue();
    const q = params.get('query') || '';
    if (mode === 'more') {
      if (params.get('offset') === '100' && failMore) {
        failMore = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic next-page failure' }) });
      }
      const offset = Number(params.get('offset'));
      const items = offset ? [{ id: applied, name: 'Long reference label '.repeat(12), status: 'inactive' }]
        : Array.from({ length: 100 }, (_, n) => ({ id: `synthetic-${n}`, name: `Choice ${n}`, status: 'active' }));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, total: 101, offset, limit: 100 }) });
    }
    if (mode === 'loading') {
      held = true; await new Promise((resolve) => { release = resolve; });
    }
    if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic lookup failure' }) });
    if (mode === 'late' && q === 'old') {
      held = true; await new Promise((resolve) => { release = resolve; });
    }
    const items = mode === 'late' ? [{ id: applied, name: q === 'old' ? 'Old late choice' : 'New current choice', status: 'active' }] : [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, total: items.length, offset: 0, limit: 100 }) }).catch(() => {});
  });
  await zone.click();
  await expect.poll(() => held).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Loading choices' })).toBeVisible();
  mode = 'empty'; release();
  await expect(page.getByText('No zones exist yet.', { exact: true })).toBeVisible();
  await zone.fill('missing');
  await expect(page.getByText('No matches found.', { exact: true })).toBeVisible();
  mode = 'error'; await zone.fill('failure');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await zone.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
  mode = 'empty';
  await page.keyboard.press('Enter');
  await expect(page.getByText('No matches found.', { exact: true })).toBeVisible();
  mode = 'late'; held = false;
  await zone.fill('old');
  await expect.poll(() => held).toBe(true);
  await zone.fill('new');
  await expect(page.getByRole('option', { name: 'New current choice', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('option', { name: 'Old late choice', exact: true })).toHaveCount(0);
  await zone.press('Tab');
  await expect(hq).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await hq.click();
  await page.getByRole('heading', { name: 'MR Master', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  mode = 'more';
  await zone.click();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.getByRole('button', { name: 'Retry load more', exact: true }).click();
  const longOption = page.getByRole('option', { name: /^Long reference label/ });
  await expect(longOption).toBeVisible();
  await longOption.click();
  await expect(zone).toHaveValue(`${'Long reference label '.repeat(12)} (inactive)`);
  await page.setViewportSize({ width: 390, height: 844 });
  await hq.click();
  const bounds = await page.locator('.mr-list-filter__menu').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: info.outputPath('mr-compact-mobile.png'), fullPage: true });
  await page.getByRole('option', { name: 'All headquarters', exact: true }).tap();
  await expect(hq).toHaveValue('All headquarters');
  mode = 'loading'; held = false;
  await zone.click();
  await expect.poll(() => held).toBe(true);
  await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  release();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
