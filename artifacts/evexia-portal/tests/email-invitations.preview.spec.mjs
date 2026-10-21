import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: {
  executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'],
} });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(120000);
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;
const chosen = 'Synthetic chosen invitation password';
const replacement = 'Synthetic accepted invitation password';

function capturedLink() {
  const path = process.env.EVEXIA_INVITATION_OUTBOX;
  if (!path?.startsWith('/tmp/evexia-auth-preview.')) throw Error('Use the isolated invitation fixture.');
  const rows = readFileSync(path, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  const url = new URL(rows.at(-1).link);
  return `${base()}${url.pathname}${url.search}${url.hash}`;
}

test('staff chosen/generated controls, captured invitation, password setup, sign-in and protected logs', async ({ page, browser }) => {
  await page.goto(`${base()}/admin/login`);
  await page.getByLabel('Email or username').fill('crm-admin@allergyevexia.in');
  await page.getByLabel('Password', { exact: true }).fill(process.env.EVEXIA_TEST_ADMIN_PASSWORD);
  await page.getByTestId('button-submit-login').click();
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.goto(`${base()}/admin/staff`);
  await page.getByTestId('button-add-staff').click();
  await page.getByTestId('input-staff-name').fill('Fictional Invitation Staff');
  await page.getByTestId('input-staff-email').fill('invitation-staff@example.com');
  await page.getByTestId('input-staff-phone').fill('9876543210');
  await page.getByTestId('select-staff-designation').selectOption('62900000-0000-4000-8000-000000000001');
  await page.getByTestId('input-staff-dateOfJoining').fill('2025-01-15');
  await page.getByTestId('button-generate-staff-password').click();
  const generated = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="input-staff-password"]').value;
    const c = document.querySelector('[data-testid="input-staff-confirmPassword"]').value;
    return p.length >= 12 && p.length <= 128 && p === c;
  });
  expect(generated, 'Generation fills both credential inputs').toBe(true);
  await page.getByTestId('input-staff-password').fill(chosen);
  await page.getByTestId('input-staff-confirmPassword').fill(chosen);
  await page.getByTestId('button-save-staff').click();
  await expect(page.getByRole('dialog')).toContainText('One-time staff credentials');
  await page.getByTestId('button-close-staff-credentials').click();
  const row = await page.evaluate(async () => {
    const { loadStaff } = await import('/src/services/staff.js');
    return (await loadStaff()).items.find((r) => r.email === 'invitation-staff@example.com');
  });
  // Save and delivery are separate; invitations do not enable missing access.
  await page.locator('.admin-staff-desktop').getByTestId(`button-invite-staff-${row.id}`).click();
  await expect(page.getByRole('dialog')).toContainText('Use Access');
  await expect(page.getByTestId('button-confirm-invitation')).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  const role = await page.evaluate(async () => {
    const { roleRequest } = await import('/src/auth/adminSession.js');
    return roleRequest('', { name: 'Fictional invitation role', description: '' });
  });
  await page.locator('.admin-staff-desktop').getByTestId(`button-access-staff-${row.id}`).click();
  await page.getByTestId(`radio-staff-access-${role.id}`).check();
  await page.getByTestId('checkbox-staff-workspace-login').check();
  await page.getByTestId('button-save-staff-access').click();
  await expect(page.getByTestId('button-save-staff-access')).toHaveCount(0);
  await page.locator('.admin-staff-desktop').getByTestId(`button-invite-staff-${row.id}`).click();
  await page.getByTestId('button-confirm-invitation').click();
  await expect(page.getByRole('dialog')).toContainText('accepted by SMTP');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-email-logs').click();
  await expect(page.getByTestId('summary-email-counts')).toContainText('1 matching');
  await page.getByLabel('Recipient (exact email)').fill('invitation-staff@example.com');
  await page.getByTestId('button-email-apply').click();
  await expect(page.getByTestId('summary-email-counts')).toContainText('SMTP accepted: 1');
  await expect(page.getByTestId('panel-email-logs').getByRole('region', { name: 'Email delivery history' })).toContainText('invitation-staff@example.com');
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await recipient.goto(capturedLink());
  await expect(recipient.getByRole('heading', { name: 'Set your EVEXIA password' })).toBeVisible();
  expect(await recipient.evaluate(() => !location.hash), 'Token fragment is scrubbed').toBe(true);
  await recipient.getByLabel('New password', { exact: true }).fill(replacement);
  await recipient.getByLabel('Confirm new password').fill(replacement);
  await recipient.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(recipient.getByTestId('status-recovery-success')).toBeVisible();
  await recipient.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(recipient).toHaveURL(`${base()}/admin/login`);
  await recipient.getByLabel('Email or username').fill(row.userId);
  await recipient.getByLabel('Password', { exact: true }).fill(replacement);
  await recipient.getByTestId('button-submit-login').click();
  await expect(recipient.getByTestId('button-admin-profile')).toBeVisible();
  await recipient.goto(`${base()}/admin/email-logs`);
  // The existing restricted-workspace boundary redirects denied routes instead
  // of mounting their own denial message or issuing a report request.
  await expect(recipient).toHaveURL(`${base()}/admin`);
  await expect(recipient.getByTestId('panel-email-logs')).toHaveCount(0);
  await context.close();
});
