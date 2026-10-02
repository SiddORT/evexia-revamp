import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

// Browser-only preview regression. Requires @playwright/test in the caller's
// environment and the isolated authenticated preview harness.
if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}

test('Communication metadata CRUD, default replacement, and credential boundary', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const invalidProviderRequests = [];
  page.on('request', (request) => {
    try {
      if (new URL(request.url()).hostname.endsWith('.invalid')) invalidProviderRequests.push(request.url());
    } catch { /* ignore malformed request URLs */ }
  });

  const base = process.env.EVEXIA_PREVIEW_BASE_URL;
  if (!base) throw new Error('Set EVEXIA_PREVIEW_BASE_URL to the running portal preview URL.');
  await authenticateAdmin(page);
  await page.goto(`${base}/admin/settings?tab=communication`);
  await expect(page.getByTestId('tab-communication-email')).toHaveAttribute('aria-selected', 'true');

  const addEmail = async (type, name, withCanary = false) => {
    await page.getByTestId('button-add-communication').click();
    if (type !== 'smtp') await page.getByTestId('select-communication-type').selectOption(type);
    await page.getByTestId('input-communication-name').fill(name);
    if (type === 'smtp') {
      await page.getByTestId('input-communication-host').fill('smtp.example.invalid');
      await page.getByTestId('input-communication-port').fill('587');
      await page.getByTestId('input-communication-username').fill('dummy');
      await page.getByTestId('input-communication-fromName').fill('Dummy');
      await page.getByTestId('input-communication-fromEmail').fill('sender@example.invalid');
    } else {
      await page.getByTestId('input-communication-provider').fill(`Demo ${type}`);
      await page.getByTestId('input-communication-endpoint').fill('https://demo.example.invalid/send');
      await page.getByTestId('input-communication-fromName').fill('Dummy');
      await page.getByTestId('input-communication-fromEmail').fill('sender@example.invalid');
    }
    if (withCanary) {
      await page.getByTestId('input-communication-secret').fill('DUMMY-COMM-CANARY');
      await page.keyboard.press('Enter'); // submit without first blurring the secret field
    } else {
      await page.getByTestId('button-communication-save').click();
    }
  };
  const card = (name) => page.locator('[data-testid^="card-communication-"]').filter({ hasText: name });

  await addEmail('smtp', 'Preview SMTP', true);
  await expect(card('Preview SMTP')).toContainText('No credentials saved.');
  await card('Preview SMTP').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await page.getByTestId('input-communication-name').fill('');
  await page.getByTestId('input-communication-secret').fill('DUMMY-COMM-CANARY');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-communication-error')).toContainText('Configuration name is required');
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await expect(page.getByTestId('input-communication-host')).toHaveValue('smtp.example.invalid');
  await page.getByTestId('input-communication-secret').fill('DUMMY-COMM-CANARY');
  await page.getByTestId('input-communication-host').focus();
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await page.getByTestId('input-communication-secret').fill('DUMMY-COMM-CANARY');
  await page.getByTestId('button-communication-cancel').click();
  await card('Preview SMTP').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await page.keyboard.press('Escape');
  const credentialAudit = await page.evaluate(() => {
    const raw = localStorage.getItem('evexia.admin.communication.v1') || '';
    const record = JSON.parse(raw);
    return {
      canaryAbsent: !raw.includes('DUMMY-COMM-CANARY') &&
        !JSON.stringify(localStorage).includes('DUMMY-COMM-CANARY') &&
        !JSON.stringify(sessionStorage).includes('DUMMY-COMM-CANARY') &&
        !location.href.includes('DUMMY-COMM-CANARY'),
      noSecretFields: Object.values(record.channels).flatMap((channel) => channel.configurations)
        .every((config) => !Object.keys(config).some((key) => /secret|token|password|apiKey/i.test(key))),
    };
  });
  expect(credentialAudit).toEqual({ canaryAbsent: true, noSecretFields: true });

  await page.getByTestId('button-add-communication').click();
  await page.getByTestId('input-communication-secret').fill('DUMMY-COMM-CANARY');
  await page.getByTestId('select-communication-type').selectOption('api');
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await page.getByTestId('button-communication-cancel').click();
  await addEmail('api', 'Preview API');
  await addEmail('platform', 'Preview Platform');
  const apiCard = card('Preview API');
  await apiCard.getByRole('button', { name: 'Make default' }).click();
  await expect(apiCard).toContainText('Default');
  await apiCard.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('radio', { name: 'Preview SMTP' }).check();
  await page.getByRole('checkbox', { name: 'I confirm the default will change.' }).check();
  await page.getByTestId('button-confirm-delete-communication').click();
  await expect(card('Preview SMTP')).toContainText('Default');
  await expect(card('Preview API')).toHaveCount(0);

  await page.getByTestId('tab-communication-sms').click();
  await page.getByTestId('button-add-communication').click();
  await page.getByTestId('input-communication-name').fill('Preview SMS');
  await page.getByTestId('input-communication-provider').fill('Demo SMS');
  await page.getByTestId('input-communication-senderId').fill('DEMO');
  await page.getByTestId('input-communication-endpoint').fill('https://demo.example.invalid/send');
  await page.getByTestId('button-communication-save').click();
  await expect(card('Preview SMS')).toContainText('DEMO');

  await page.getByTestId('tab-communication-waba').click();
  await page.getByTestId('button-add-communication').click();
  await page.getByTestId('input-communication-name').fill('Preview WABA');
  await page.getByTestId('input-communication-provider').fill('Demo WABA');
  await page.getByTestId('input-communication-endpoint').fill('https://demo.example.invalid/send');
  await page.getByTestId('input-communication-businessAccountId').fill('123456');
  await page.getByTestId('input-communication-phoneNumberId').fill('654321');
  await page.getByTestId('input-communication-senderPhone').fill('+919876543210');
  await page.getByTestId('input-communication-apiVersion').fill('v23.0');
  await page.getByTestId('button-communication-save').click();
  const waba = card('Preview WABA');
  await expect(waba).toContainText('No credentials saved.');
  await waba.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('input-communication-businessAccountId')).toHaveValue('123456');
  await expect(page.getByTestId('input-communication-phoneNumberId')).toHaveValue('654321');
  await expect(page.getByTestId('input-communication-apiVersion')).toHaveValue('v23.0');
  await expect(page.getByTestId('input-communication-secret')).toHaveValue('');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth ||
    document.body.scrollWidth > document.body.clientWidth);
  expect(overflow).toBe(false);
  expect(invalidProviderRequests.length).toBe(0);

  await context.close();
});