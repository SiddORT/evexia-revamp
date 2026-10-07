import { test, expect } from '@playwright/test';
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
    return { hq: hq.id, zone: zone.id };
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
for (const mobile of [false, true]) {
  test(`MR ${mobile ? 'mobile' : 'desktop'} full form, PIN, persistence, one-time password and real MR home`, async ({ page }, info) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const label = mobile ? 'Mobile' : 'Desktop';
    const refs = await directory(page, label);
    await expect(page.getByText('Legacy MR remains local', { exact: true })).toHaveCount(0);
    await page.getByTestId('button-add-mr').click();
    await page.getByTestId('select-mr-contactRequirement').selectOption('optional');
    await page.getByTestId('input-mr-name').fill(`Synthetic ${label} MR`);
    await page.getByTestId('button-generate-mr-user-id').click();
    await expect(page.getByTestId('input-mr-userId')).toHaveValue(/^mr\.[a-f0-9]+$/);
    const username = await page.getByTestId('input-mr-userId').inputValue();
    await page.getByTestId('tab-mr-assignment').click();
    await expect(page.getByTestId('select-mr-headquarters').locator(`option[value="${refs.hq}"]`)).toHaveCount(1);
    await page.getByTestId('select-mr-headquarters').selectOption(refs.hq);
    await page.getByTestId('select-mr-zones').selectOption(refs.zone);
    await page.getByTestId('input-mr-employeeCode').fill(`MR-${label}`);
    await page.getByTestId('input-mr-dateOfJoining').fill('2020-01-01');
    await page.getByTestId('input-mr-designation').fill('MR business label only');
    await page.getByTestId('input-mr-paymentLimit').fill('123.45');
    await page.getByTestId('input-mr-doctorDaysLimit').fill('12');
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
    expect(saved.credentials.userId).toBe(username);
    await expect(page.getByTestId('button-close-credentials')).toBeDisabled();
    await page.getByTestId('button-toggle-credentials').click();
    await expect(page.getByTestId(`text-credential-${username}`)).toHaveText(saved.credentials.password);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain(saved.credentials.password);
    await discard(page);
    await expect(page.getByTestId('text-mr-count')).toBeVisible();
    const record = page.locator(mobile ? 'article[role=listitem]' : 'tbody tr').filter({ hasText: `Synthetic ${label} MR` });
    await expect(record).toContainText('Super Admin');
    await record.getByTestId(`button-doctors-mr-${saved.record.id}`).click();
    await expect(page.getByTestId('text-mr-doctors-unavailable')).toContainText('not linked');
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
    await page.getByTestId('button-save-mr').click();
    await expect(page.getByTestId('text-mr-count')).toBeVisible();
    await page.getByTestId('select-mr-zones').selectOption(refs.zone);
    await page.getByTestId('select-mr-headquarters').selectOption(refs.hq);
    await page.getByTestId('select-filter-mr-status').selectOption('active');
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
  const csv = `${headers}\nMR-Transfer,Synthetic Transfer MR,,synthetic.transfer,,optional,MR Transfer HQ,MR Transfer Zone,2020-01-01,MR label,,0.00,0,active,Synthetic street,,Landmark,110001,Delhi,Delhi,India\n`;
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
  await page.getByTestId('select-mr-zones').selectOption(refs.zone);
  await page.getByTestId('select-mr-headquarters').selectOption(refs.hq);
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
  await page.getByTestId('select-filter-mr-status').selectOption('inactive');
  await expect(page.getByTestId('text-mr-count')).toContainText('of 1');
  await page.getByTestId('button-export-mrs').click();
  const exported = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Excel (.xlsx)' }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.xlsx$/);
});
