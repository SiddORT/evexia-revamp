import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { readFileSync } from 'node:fs';

if (process.env.EVEXIA_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
}
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const row = (n, provenance = 'server_prepared') => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user: { id: '11111111-1111-4111-8111-111111111111', label: 'Synthetic Admin', role: 'Super Admin', account_state: 'ACTIVE' }, created_at: '2030-02-02T10:00:00Z', label: `Report ${n}`, module: 'Zone Master', format: 'CSV', provenance });

test('profile menu opens Download Logs; filters, pagination, states', async ({ page }) => {
  const seen = [];
  await page.route('**/reporting/downloads*', async (route) => {
    const u = new URL(route.request().url());
    seen.push(u);
    const offset = Number(u.searchParams.get('offset') || 0);
    if (u.searchParams.get('q') === 'nothing') return route.fulfill({ json: { items: [], total: 0, limit: 25, offset, has_more: false } });
    if (u.searchParams.get('q') === 'boom') return route.fulfill({ status: 500, json: { detail: 'x' } });
    const items = Array.from({ length: 25 }, (_, i) => row(offset + i + 1, i % 2 ? 'browser_reported' : 'server_prepared'));
    return route.fulfill({ json: { items, total: 60, limit: 25, offset, has_more: offset + 25 < 60 } });
  });
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin`);
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-download-logs').click();
  await expect(page).toHaveURL(/\/admin\/download-logs$/);
  await expect(page.getByRole('heading', { name: 'Download Logs' })).toBeVisible();
  await expect(page.getByText(/Neither confirms the file finished saving/)).toBeVisible();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first().locator('td').first()).toHaveText('1');
  await expect(page.getByText('Browser-reported handoff').first()).toBeVisible();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first().locator('td').first()).toHaveText('26');
  expect(seen.some((u) => u.searchParams.get('offset') === '25')).toBe(true);

  await page.getByTestId('button-download-filters').click();
  await page.getByTestId('input-download-start').fill('2030-02-02');
  await page.getByTestId('input-download-end').fill('2030-02-01');
  await page.getByTestId('button-download-apply').click();
  await expect(page.getByTestId('status-download-filter-error')).toBeVisible();
  await page.getByTestId('input-download-end').fill('2030-02-02');
  await page.getByTestId('select-download-format').selectOption('XLSX');
  await page.getByTestId('button-download-apply').click();
  await expect.poll(() => seen.some((u) => u.searchParams.get('end') === '2030-02-03T00:00:00Z' && u.searchParams.get('format') === 'XLSX' && u.searchParams.get('offset') === '0')).toBe(true);

  await page.getByTestId('input-download-search').fill('nothing');
  await expect(page.getByTestId('status-download-empty')).toBeVisible();
  await page.getByTestId('input-download-search').fill('boom');
  await expect(page.getByTestId('status-download-error')).toBeVisible();
  await page.getByTestId('button-download-reset').click();
  await expect(page.getByTestId('table-download-logs')).toBeVisible();
});

test('real cross-format downloads wait for durable acceptance and history survives local clearing', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  const baseline = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  const reports = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/downloads/initiate')) reports.push(request.postDataJSON());
  });
  const metadata = { source: 'zone', kind: 'sample', format: 'CSV' };
  await page.route('**/reporting/downloads/initiate', (route) => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  let downloads = 0;
  page.on('download', () => downloads++);
  const failure = await page.evaluate(async (metadata) => {
    try { await (await import('/src/services/downloads.js')).downloadBlob(new Blob(['sample']), 'zone.csv', metadata); }
    catch (e) { return e.message; }
  }, metadata);
  expect(failure).toContain('No file was released');
  expect(downloads).toBe(0);
  await page.unroute('**/reporting/downloads/initiate');
  for (const format of ['CSV', 'XLSX']) {
    const event = page.waitForEvent('download');
    await page.evaluate(async (format) => {
      const { downloadBlob } = await import('/src/services/downloads.js');
      const { sampleExcel } = await import('/src/services/mockExcelImport.js');
      await downloadBlob(format === 'XLSX' ? sampleExcel('zone') : new Blob(['Zone Name,Status\r\nSample,Active\r\n']),
        `zone.${format.toLowerCase()}`, { source: 'zone', kind: 'sample', format });
    }, format);
    const downloaded = await event;
    expect(await downloaded.failure()).toBeNull();
    const bytes = readFileSync(await downloaded.path());
    if (format === 'XLSX') expect(bytes.subarray(0, 2).toString()).toBe('PK');
    else expect(bytes.toString()).toContain('Zone Name');
  }
  // Preview/building document SVG has no initiation; all actual layouts and PR variants do.
  const countBeforePDF = reports.length;
  await page.evaluate(async () => {
    (await import('/src/services/poInvoiceTemplates.js')).makeSampleInvoiceDocument('classic');
    (await import('/src/services/prDocuments.js')).makeSamplePRDocument('classic');
  });
  expect(reports.length).toBe(countBeforePDF);
  for (const template of ['classic', 'modern', 'compact']) {
    for (const family of ['po', 'searchable', 'image']) {
      const event = page.waitForEvent('download');
      await page.evaluate(async ({ template, family }) => {
        if (family === 'po') {
          const document = (await import('/src/services/poInvoiceTemplates.js')).makeSampleInvoiceDocument(template);
          await (await import('/src/services/poInvoicePdf.js')).downloadInvoiceDocument(document, 'sample.pdf', '/images/evexia-logo.png');
        } else {
          const { makeSamplePRDocument, downloadPRDocument } = await import('/src/services/prDocuments.js');
          await downloadPRDocument(makeSamplePRDocument(template), 'sample.pdf', '/images/evexia-logo.png', { format: family });
        }
      }, { template, family });
      const downloaded = await event;
      expect(await downloaded.failure()).toBeNull();
      expect(readFileSync(await downloaded.path()).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }
  for (const report of reports) {
    expect(Object.keys(report).sort()).toEqual(['format', 'initiation_id', 'kind', 'source']);
  }
  const total = await page.evaluate(async () => (await (await import('/src/auth/adminSession.js')).reportingRequest('downloads')).total);
  expect(total).toBe(baseline + 11);
  // A deliberate repeat has a new initiation and does not reuse the outage retry's key.
  expect(reports[0].initiation_id).toBe(reports[1].initiation_id);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${base()}/admin/download-logs`);
  await expect(page.getByRole('heading', { name: 'Download Logs' })).toBeVisible();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first()).toContainText('PR receipt');
  await page.screenshot({ path: testInfo.outputPath('download-logs-desktop.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Download Logs' })).toBeVisible();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first()).toContainText('PR receipt');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('input-download-search')).toBeVisible();
  await expect(page.getByTestId('table-download-logs')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('download-logs-mobile.png'), fullPage: true });
});
