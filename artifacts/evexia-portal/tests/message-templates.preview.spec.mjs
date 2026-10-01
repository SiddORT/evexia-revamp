import { test, expect } from '@playwright/test';

// Nix environments can use their installed, library-compatible Chromium.
if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH } });
}

const templatesUrl = (base) => `${base}/admin/settings?tab=message-templates`;
const libraryKey = 'evexia.admin.message-templates.v1';

async function openTemplates(browser) {
  const base = process.env.EVEXIA_PREVIEW_BASE_URL;
  if (!base) throw new Error('Set EVEXIA_PREVIEW_BASE_URL to the running portal preview URL.');
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(templatesUrl(base));
  await expect(page.getByTestId('button-template-new')).toBeVisible();
  return { context, page, base };
}

test('copies and manages user templates, preserves SMS IDs as strings, and validates required fields', async ({ browser }) => {
  const { context, page } = await openTemplates(browser);
  try {
    await page.getByTestId('button-template-new').click();
    await page.getByTestId('button-template-save').click();
    await expect(page.getByTestId('input-template-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('input-template-subject')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('input-template-html')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('input-template-text')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('button-template-close').click();

    await page.getByTestId('tab-template-sms').click();
    await page.getByTestId('select-template-source').selectOption('system');
    await page.getByTestId('input-template-search').fill('Order confirmation');
    const systemCard = page.getByTestId('card-template-system-sms-order-confirmation');
    await expect(systemCard).toBeVisible();
    await systemCard.getByTestId('button-copy-template-system-sms-order-confirmation').click();
    await page.getByTestId('input-template-name').fill('Copied SMS receipt');
    await page.getByTestId('button-template-save').click();
    await expect(page.getByTestId('input-template-providerTemplateId')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('input-template-providerTemplateId').fill('000123');
    await page.getByTestId('button-template-save').click();
    await expect(page.getByTestId('text-template-status')).toContainText('Template saved');

    const saved = await page.evaluate((key) => {
      const record = JSON.parse(localStorage.getItem(key));
      return record.templates.find((template) => template.name === 'Copied SMS receipt');
    }, libraryKey);
    expect(saved).toMatchObject({
      source: 'user',
      channel: 'sms',
      name: 'Copied SMS receipt',
      content: { providerTemplateId: '000123' },
    });
    expect(typeof saved.content.providerTemplateId).toBe('string');

    await page.reload();
    await page.getByTestId('tab-template-sms').click();
    await expect(page.getByTestId(`card-template-${saved.id}`)).toBeVisible();
    await page.getByTestId('select-template-source').selectOption('user');
    await page.getByTestId('input-template-search').fill('');
    await page.getByTestId(`button-edit-template-${saved.id}`).click();
    await page.getByTestId('input-template-body').fill('Revised order {{order_number}}');
    await page.getByTestId('button-template-save').click();
    await expect(page.getByTestId(`card-template-${saved.id}`)).toContainText('Copied SMS receipt');
    const edited = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), libraryKey);
    expect(edited.templates).toHaveLength(1);
    expect(edited.templates[0]).toMatchObject({
      id: saved.id,
      content: { providerTemplateId: '000123', body: 'Revised order {{order_number}}' },
    });

    await page.getByTestId(`button-delete-template-${saved.id}`).click();
    await page.getByTestId('button-confirm-delete-template').click();
    await expect(page.getByTestId(`card-template-${saved.id}`)).toHaveCount(0);
    await expect(page.getByTestId('text-template-status')).toContainText('Template deleted');
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).templates, libraryKey)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('rejects bad HTML imports without replacing drafts and safely previews imported, reloaded HTML and sample values', async ({ browser }) => {
  const { context, page } = await openTemplates(browser);
  const suspiciousRequests = [];
  page.on('request', (request) => {
    try {
      if (new URL(request.url()).hostname === 'preview-canary.invalid') suspiciousRequests.push(request.url());
    } catch { /* ignore malformed request URLs */ }
  });
  const attackHtml = `<!doctype html>
    <table border="1"><tr><th>Receipt</th></tr><tr><td>{{recipient_name}}</td></tr></table>
    <p>{{unknown_token}} {{broken</p>
    <p style="color:red;background-image:url(https://preview-canary.invalid/style)">Safe formatting</p>
    <script>parent.__messageTemplatePwned=true;location.href='https://preview-canary.invalid/script'</script>
    <img src="https://preview-canary.invalid/pixel" onerror="parent.__messageTemplatePwned=true">
    <iframe src="https://preview-canary.invalid/frame"></iframe>
    <form action="https://preview-canary.invalid/form"><button>Send</button></form>`;
  try {
    await page.getByTestId('card-template-system-email-order-confirmation')
      .getByTestId('button-copy-template-system-email-order-confirmation').click();
    const htmlField = page.getByTestId('input-template-html');
    const originalDraft = await htmlField.inputValue();
    const fileInput = page.getByTestId('input-template-file');

    await fileInput.setInputFiles({
      name: 'bad-encoding.html',
      mimeType: 'text/html',
      buffer: Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e]),
    });
    await expect(page.getByTestId('text-template-error')).toContainText('not valid UTF-8');
    await expect(htmlField).toHaveValue(originalDraft);

    await fileInput.setInputFiles({
      name: 'oversize.html',
      mimeType: 'text/html',
      buffer: Buffer.alloc(100_001, 0x61),
    });
    await expect(page.getByTestId('text-template-error')).toContainText('100,000 bytes or smaller');
    await expect(htmlField).toHaveValue(originalDraft);

    const attackFile = { name: 'untrusted.html', mimeType: 'text/html', buffer: Buffer.from(attackHtml) };
    const dismissed = page.waitForEvent('dialog');
    await fileInput.setInputFiles(attackFile);
    await (await dismissed).dismiss();
    await expect(htmlField).toHaveValue(originalDraft);

    const accepted = page.waitForEvent('dialog');
    await fileInput.setInputFiles(attackFile);
    await (await accepted).accept();
    await expect(htmlField).toHaveValue(attackHtml);
    await page.getByTestId('input-template-name').fill('Imported safe preview');
    await page.getByTestId('button-template-save').click();
    const storedRaw = await page.evaluate((key) => localStorage.getItem(key), libraryKey);

    await page.reload();
    const template = await page.evaluate((key) => {
      const record = JSON.parse(localStorage.getItem(key));
      return record.templates.find((item) => item.name === 'Imported safe preview');
    }, libraryKey);
    await page.getByTestId(`button-preview-template-${template.id}`).click();
    await expect(page.getByTestId('mtv-warn-unknown')).toContainText('{{unknown_token}}');
    await expect(page.getByTestId('mtv-warn-malformed')).toBeVisible();
    await expect(page.getByTestId('mtv-warn-blocked')).toBeVisible();

    const frame = page.locator('[data-testid="mtv-frame"]');
    await expect(frame).toHaveAttribute('sandbox', '');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    const rendered = page.frameLocator('[data-testid="mtv-frame"]');
    await expect(rendered.locator('table')).toHaveCount(1);
    await expect(rendered.locator('th')).toHaveText('Receipt');
    await expect(rendered.locator('img, script, iframe, form')).toHaveCount(0);
    await expect(rendered.locator('meta[http-equiv="Content-Security-Policy"]'))
      .toHaveAttribute('content', /script-src 'none'/);
    await expect(rendered.locator('p').filter({ hasText: 'Safe formatting' })).toHaveCSS('color', 'rgb(255, 0, 0)');

    const injectedSample = '<img src="https://preview-canary.invalid/sample" onerror="parent.__messageTemplatePwned=true">';
    await page.getByTestId('mtv-mode-sample').click();
    await page.getByTestId('mtv-sample-recipient_name').fill(injectedSample);
    await expect(rendered.locator('body')).toContainText(injectedSample);
    await expect(rendered.locator('img, script, iframe, form')).toHaveCount(0);
    expect(await page.evaluate(() => window.__messageTemplatePwned || false)).toBe(false);
    expect(await page.evaluate((key) => localStorage.getItem(key), libraryKey)).toBe(storedRaw);
    expect(suspiciousRequests).toEqual([]);
    expect(page.url()).toContain('/admin/settings?tab=message-templates');
  } finally {
    await context.close();
  }
});

test('blocks stale cross-tab overwrites, preserves drafts on write failure, and never repairs corrupt storage', async ({ browser }) => {
  const { context, page, base } = await openTemplates(browser);
  try {
    const templateId = await page.evaluate(async () => {
      const { loadMessageTemplates, saveMessageTemplate } = await import('/src/services/messageTemplates.js');
      const input = {
        channel: 'email',
        name: 'Cross-tab template',
        description: '',
        content: { subject: 'Original subject', html: '<p>Original</p>', text: 'Original' },
      };
      const saved = await saveMessageTemplate(loadMessageTemplates(), input);
      return saved.record.templates[0].id;
    });
    await page.reload();

    const otherTab = await context.newPage();
    await otherTab.goto(templatesUrl(base));
    await expect(otherTab.getByTestId(`card-template-${templateId}`)).toBeVisible();
    await page.getByTestId(`button-edit-template-${templateId}`).click();
    await page.getByTestId('input-template-subject').fill('Unsaved first-tab edit');

    const latestRaw = await otherTab.evaluate(async (id) => {
      const { loadMessageTemplates, saveMessageTemplate } = await import('/src/services/messageTemplates.js');
      const snapshot = loadMessageTemplates();
      const current = snapshot.record.templates.find((template) => template.id === id);
      return (await saveMessageTemplate(snapshot, {
        channel: current.channel,
        name: current.name,
        description: current.description,
        content: { ...current.content, subject: 'Saved in second tab' },
      }, id)).raw;
    }, templateId);
    await expect(page.getByTestId('text-template-stale')).toBeVisible();
    await expect(page.getByTestId('input-template-subject')).toHaveValue('Unsaved first-tab edit');
    await expect(page.getByTestId('button-template-save')).toBeDisabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), libraryKey)).toBe(latestRaw);
    expect(JSON.parse(latestRaw).templates[0].content.subject).toBe('Saved in second tab');

    const discardStaleDraft = page.waitForEvent('dialog');
    const staleReload = page.reload();
    await (await discardStaleDraft).accept();
    await staleReload;
    await page.getByTestId('button-template-new').click();
    await page.getByTestId('input-template-name').fill('Write failure draft');
    await page.getByTestId('input-template-subject').fill('Keep this subject');
    await page.getByTestId('input-template-html').fill('<p>Keep this HTML</p>');
    await page.getByTestId('input-template-text').fill('Keep this text');
    const beforeFailedWrite = await page.evaluate((key) => localStorage.getItem(key), libraryKey);
    await page.evaluate((key) => {
      window.__templateSetItemOriginal = Storage.prototype.setItem;
      Storage.prototype.setItem = function (itemKey, value) {
        if (itemKey === key) throw new Error('simulated quota');
        return window.__templateSetItemOriginal.call(this, itemKey, value);
      };
    }, libraryKey);
    await page.getByTestId('button-template-save').click();
    await expect(page.getByTestId('text-template-error')).toContainText('could not be saved');
    await expect(page.getByTestId('input-template-name')).toHaveValue('Write failure draft');
    await expect(page.getByTestId('input-template-subject')).toHaveValue('Keep this subject');
    await expect(page.getByTestId('input-template-html')).toHaveValue('<p>Keep this HTML</p>');
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__templateSetItemOriginal;
      delete window.__templateSetItemOriginal;
    });
    expect(await page.evaluate((key) => localStorage.getItem(key), libraryKey)).toBe(beforeFailedWrite);

    const corrupt = '{not a valid template record';
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: libraryKey, value: corrupt });
    const discardFailedWriteDraft = page.waitForEvent('dialog');
    const failedWriteReload = page.reload();
    await (await discardFailedWriteDraft).accept();
    await failedWriteReload;
    await expect(page.getByTestId('text-template-load-error')).toBeVisible();
    const system = page.getByTestId('card-template-system-email-order-confirmation');
    await expect(system).toBeVisible();
    await system.getByTestId('button-copy-template-system-email-order-confirmation').click();
    await expect(page.getByTestId('input-template-name')).toBeVisible();
    const discardCorruptStorageDraft = page.waitForEvent('dialog');
    const closeCorruptDraft = page.getByTestId('button-template-close').click();
    await (await discardCorruptStorageDraft).accept();
    await closeCorruptDraft;
    expect(await page.evaluate((key) => localStorage.getItem(key), libraryKey)).toBe(corrupt);
  } finally {
    await context.close();
  }
});

test('guards dirty category navigation and supports browser history, keyboard tabs, narrow layout and color schemes', async ({ browser }) => {
  const base = process.env.EVEXIA_PREVIEW_BASE_URL;
  if (!base) throw new Error('Set EVEXIA_PREVIEW_BASE_URL to the running portal preview URL.');
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'light', ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/admin/settings?tab=basic`);
    await expect(page.getByTestId('link-settings-basic')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('link-settings-message-templates').click();
    await expect(page).toHaveURL(/tab=message-templates/);

    const emailTab = page.getByTestId('tab-template-email');
    await emailTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-template-sms')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(emailTab).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('button-template-new').click();
    const name = page.getByTestId('input-template-name');
    await name.fill('Unsaved navigation draft');
    const rejectedNavigation = page.waitForEvent('dialog');
    const rejectedClick = page.getByTestId('link-settings-basic').click();
    await (await rejectedNavigation).dismiss();
    await rejectedClick;
    await expect(page).toHaveURL(/tab=message-templates/);
    await expect(name).toHaveValue('Unsaved navigation draft');
    await name.fill('');
    await page.getByTestId('link-settings-basic').click();
    await expect(page).toHaveURL(/tab=basic/);
    await expect(page.getByTestId('link-settings-basic')).toHaveAttribute('aria-current', 'page');

    await page.goBack();
    await expect(page).toHaveURL(/tab=message-templates/);
    await expect(page.getByTestId('button-template-new')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/tab=basic/);

    // Admin has explicit appearance choices; device media settings alone do
    // not exercise the current light/dark implementation.
    for (const appearance of ['light', 'dark']) {
      await page.getByTestId('link-settings-ui').click();
      await page.getByTestId('select-admin-appearance').selectOption(appearance);
      for (const theme of ['classic', 'modern']) {
        await page.getByTestId('select-admin-theme').selectOption(theme);
        await page.getByTestId('link-settings-message-templates').click();
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
        await page.getByTestId('button-template-new').click();
        await expect(page.getByTestId('input-template-html')).toBeVisible();
        expect(await page.evaluate(() =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
          document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
        await page.getByTestId('button-template-close').click();
        await page.getByTestId('link-settings-ui').click();
      }
    }
  } finally {
    await context.close();
  }
});