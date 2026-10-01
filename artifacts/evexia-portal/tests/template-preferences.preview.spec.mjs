import { test, expect } from '@playwright/test';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}

const PO_KEY = 'evexia.admin.document-templates.v1';
const PR_KEY = 'evexia.admin.pr-receipt-template.v1';
const recordKeys = ['evexia.admin.purchase-orders.v1', 'evexia.admin.purchase-received.v1'];
const current = (page, name, label) => page.getByRole('button', { name: `${name} is the default ${label} template`, exact: true });
const storage = (page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

async function openTabs(browser) {
  const base = process.env.EVEXIA_PREVIEW_BASE_URL;
  if (!base) throw Error('Set EVEXIA_PREVIEW_BASE_URL to the running portal preview URL.');
  const context = await browser.newContext();
  const writer = await context.newPage();
  await writer.goto(`${base.replace(/\/$/, '')}/admin/settings?tab=templates`);
  await writer.evaluate((keys) => {
    for (const key of keys) localStorage.setItem(key, `unchanged fixture: ${key}`);
  }, recordKeys);
  const reader = await context.newPage();
  await reader.goto(`${base.replace(/\/$/, '')}/admin/settings?tab=templates`);
  await expect(current(reader, 'EVEXIA Classic', 'PO invoice')).toBeVisible();
  // Audit refreshes in the observing tab: no preference or record mutations.
  await reader.evaluate(() => {
    window.observedWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.observedWrites.push([method, ...args]);
        return original.apply(this, args);
      };
    }
  });
  return { context, writer, reader };
}

async function reset(page, label) {
  await page.getByRole('button', { name: `Reset ${label} preference`, exact: true }).click();
  await page.getByTestId('button-confirm-action').click();
}

test('PO defaults refresh across two tabs; corruption requires explicit recovery and leaves PR/records alone', async ({ browser }) => {
  const { context, writer, reader } = await openTabs(browser);
  try {
    await writer.getByRole('button', { name: 'Use EVEXIA Modern as default PO invoice template' }).click();
    await expect(current(reader, 'EVEXIA Modern', 'PO invoice')).toBeVisible();
    await writer.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, defaultPRReceiptTemplate: 'classic' })), PR_KEY);
    const before = await storage(writer);
    await reset(writer, 'PO invoice');
    await expect(current(reader, 'EVEXIA Classic', 'PO invoice')).toBeVisible();
    await writer.evaluate((key) => localStorage.setItem(key, '{broken'), PO_KEY);
    await expect(reader.getByRole('alert')).toContainText('unreadable');
    await expect(reader.getByRole('button', { name: /is the default PO invoice template/ })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Use EVEXIA Modern as default PO invoice template' })).toBeDisabled();
    await expect.poll(async () => (await storage(writer))[PO_KEY]).toBe('{broken');
    // Unrelated events do not clear the PO error.
    await writer.evaluate((key) => localStorage.removeItem(key), PR_KEY);
    await expect(reader.getByRole('alert')).toContainText('unreadable');
    await reset(writer, 'PO invoice');
    await expect(reader.getByRole('alert')).toContainText('retry loading to confirm recovery');
    await reader.getByRole('button', { name: 'Retry loading PO invoice preference' }).click();
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await expect(current(reader, 'EVEXIA Classic', 'PO invoice')).toBeVisible();
    // Invalid schema is also actionable; reset requires confirmation.
    await writer.evaluate((key) => localStorage.setItem(key, '{"version":1,"defaultPOInvoiceTemplate":"unknown"}'), PO_KEY);
    await expect(reader.getByRole('alert')).toContainText('invalid');
    await reset(reader, 'PO invoice');
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await expect(current(reader, 'EVEXIA Classic', 'PO invoice')).toBeVisible();
    const after = await storage(writer);
    for (const key of recordKeys) expect(after[key]).toBe(before[key]);
    expect(after[PR_KEY]).toBeUndefined(); // PO reset did not recreate PR's choice.
    expect(await reader.evaluate(() => window.observedWrites)).toEqual([['removeItem', PO_KEY]]);
  } finally { await context.close(); }
});

test('PR save/reset events preserve PO choice; errors stay visible until retry or confirmed PR reset', async ({ browser }) => {
  const { context, writer, reader } = await openTabs(browser);
  try {
    await writer.getByRole('button', { name: 'Use EVEXIA Compact as default PO invoice template' }).click();
    await reader.getByLabel('Document type').selectOption('pr');
    await writer.getByLabel('Document type').selectOption('pr');
    const before = await storage(writer);
    for (const name of ['EVEXIA Modern', 'EVEXIA Compact', 'EVEXIA Classic']) {
      await writer.getByRole('button', { name: `Use ${name} as default PR receipt template`, exact: true }).click();
      await expect(current(reader, name, 'PR receipt')).toBeVisible();
      expect((await storage(writer))[PO_KEY]).toBe(before[PO_KEY]);
    }
    await writer.evaluate((key) => localStorage.setItem(key, '{broken'), PR_KEY);
    await expect(reader.getByRole('alert')).toContainText('unreadable');
    // A valid later write must not silently clear the observing gallery's error.
    await writer.evaluate(async () => {
      const service = await import('/src/services/prReceiptTemplates.js');
      service.resetPRTemplatePreference();
      service.setDefaultPRTemplate('classic');
    });
    await expect(reader.getByRole('alert')).toContainText('unreadable');
    await reader.getByRole('button', { name: 'Retry loading PR receipt preference' }).click();
    await expect(current(reader, 'EVEXIA Classic', 'PR receipt')).toBeVisible();
    await writer.evaluate((key) => localStorage.removeItem(key), PR_KEY);
    await expect(current(reader, 'EVEXIA Classic', 'PR receipt')).toBeVisible();
    await writer.evaluate((key) => localStorage.setItem(key, '{"version":9,"defaultPRReceiptTemplate":"classic"}'), PR_KEY);
    await expect(reader.getByRole('alert')).toContainText('invalid');
    // Changing PO cannot dismiss PR's error.
    await writer.getByLabel('Document type').selectOption('po');
    await writer.getByRole('button', { name: 'Use EVEXIA Modern as default PO invoice template' }).click();
    await expect(reader.getByRole('alert')).toContainText('invalid');
    const po = (await storage(writer))[PO_KEY];
    await reset(reader, 'PR receipt');
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await expect(current(reader, 'EVEXIA Classic', 'PR receipt')).toBeVisible();
    const after = await storage(writer);
    expect(after[PO_KEY]).toBe(po);
    for (const key of recordKeys) expect(after[key]).toBe(before[key]);
    expect(await reader.evaluate(() => window.observedWrites)).toEqual([['removeItem', PR_KEY]]);
    // Switch back: the independent PO gallery reads the latest PO preference.
    await reader.getByLabel('Document type').selectOption('po');
    await expect(current(reader, 'EVEXIA Modern', 'PO invoice')).toBeVisible();
  } finally { await context.close(); }
});

test('all PR cards work on narrow light/dark galleries with keyboard selection, reload and failed saves', async ({ browser }) => {
  const { context, writer: page, reader } = await openTabs(browser);
  try {
    await reader.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Document type').selectOption('pr');
    const cards = page.getByRole('list', { name: 'PR receipt template previews' }).locator('li');
    await expect(cards).toHaveCount(3);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.querySelector('[data-admin-appearance]')?.setAttribute('data-admin-appearance', theme);
      }, theme);
      for (const card of await cards.all()) {
        await expect(card.locator('svg')).toBeVisible();
        await expect(card.getByText('Sample · Preview only', { exact: true })).toBeVisible();
        const bounds = await card.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      }
    }
    for (const name of ['EVEXIA Modern', 'EVEXIA Compact']) {
      const button = page.getByRole('button', { name: `Use ${name} as default PR receipt template`, exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(current(page, name, 'PR receipt')).toBeVisible();
      await page.reload();
      await page.getByLabel('Document type').selectOption('pr');
      await expect(current(page, name, 'PR receipt')).toBeVisible();
    }
    await page.evaluate(() => {
      window.originalPRSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw Error('quota'); };
    });
    await page.getByRole('button', { name: 'Use EVEXIA Modern as default PR receipt template', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(current(page, 'EVEXIA Compact', 'PR receipt')).toBeVisible();
    await page.evaluate(() => { Storage.prototype.setItem = window.originalPRSetItem; });
    await reset(page, 'PR receipt');
    await expect(current(page, 'EVEXIA Classic', 'PR receipt')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); }
});

test('external changes do not silently dismiss failed save/reset or blocked-storage errors', async ({ browser }) => {
  const { context, writer, reader } = await openTabs(browser);
  try {
    await reader.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw Error('quota'); };
    });
    await reader.getByRole('button', { name: 'Use EVEXIA Modern as default PO invoice template' }).click();
    await expect(reader.getByRole('alert')).toContainText('could not be saved');
    await writer.getByRole('button', { name: 'Use EVEXIA Compact as default PO invoice template' }).click();
    await expect(current(reader, 'EVEXIA Compact', 'PO invoice')).toBeVisible();
    await expect(reader.getByRole('alert')).toContainText('could not be saved');
    await reader.evaluate(() => {
      Storage.prototype.setItem = window.originalSetItem;
      window.originalRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = () => { throw Error('denied'); };
    });
    await reset(reader, 'PO invoice');
    await expect(reader.getByRole('dialog').getByRole('alert')).toContainText('could not be reset');
    await writer.getByRole('button', { name: 'Use EVEXIA Modern as default PO invoice template' }).click();
    await expect(current(reader, 'EVEXIA Modern', 'PO invoice')).toBeVisible();
    await expect(reader.getByRole('dialog').getByRole('alert')).toContainText('could not be reset');
    await reader.evaluate(() => { Storage.prototype.removeItem = window.originalRemoveItem; });
    await reader.getByTestId('button-confirm-action').click();
    await expect(reader.getByRole('dialog')).toHaveCount(0);
    await expect(reader.getByRole('alert')).toHaveCount(0);

    await reader.evaluate(() => {
      window.originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = () => { throw Error('blocked storage'); };
    });
    await writer.getByRole('button', { name: 'Use EVEXIA Compact as default PO invoice template' }).click();
    await expect(reader.getByRole('alert')).toContainText('could not be read');
    await expect(reader.getByRole('alert')).toContainText('fixing storage access');
    await reader.evaluate(() => { Storage.prototype.getItem = window.originalGetItem; });
    await reader.getByRole('button', { name: 'Retry loading PO invoice preference' }).click();
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await expect(current(reader, 'EVEXIA Compact', 'PO invoice')).toBeVisible();
  } finally { await context.close(); }
});