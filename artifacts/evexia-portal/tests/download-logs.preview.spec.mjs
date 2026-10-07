import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { readFileSync } from 'node:fs';

// Engine launch settings live in playwright.downloads.config.mjs, not here:
// a spec-level Chromium executable override would corrupt Firefox/WebKit runs.
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
test.beforeAll(async ({ browser, browserName }) => {
  console.log(`Download regression engine: ${browserName} ${browser.version()}`);
});
const row = (n, provenance = 'server_prepared') => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user: { id: '11111111-1111-4111-8111-111111111111', label: 'Synthetic Admin', role: 'Super Admin', account_state: 'ACTIVE' }, created_at: '2030-02-02T10:00:00Z', label: `Report ${n}`, module: 'Zone Master', format: 'CSV', provenance });

async function openAdmin(page) {
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
}

async function history(page) {
  return page.evaluate(async () => (await import('/src/auth/adminSession.js')).reportingRequest('downloads'));
}

async function instrumentHandoff(page) {
  await page.evaluate(() => {
    window.handoff = { creates: 0, clicks: 0, revokes: 0, fail: '' };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => {
      window.handoff.creates++;
      if (window.handoff.fail === 'url') throw new Error('synthetic object URL failure');
      return create(blob);
    };
    URL.revokeObjectURL = (url) => { window.handoff.revokes++; return revoke(url); };
    HTMLAnchorElement.prototype.click = function () {
      window.handoff.clicks++;
      if (window.handoff.fail === 'click') throw new Error('synthetic browser refusal');
      return click.call(this);
    };
  });
}

// Store a settled outcome immediately to avoid unhandled rejections while the
// test holds an API acknowledgement or deliberately changes a session.
async function startLocalDownload(page) {
  await page.evaluate(async () => {
    const { downloadBlob } = await import('/src/services/downloads.js');
    window.pendingDownload = downloadBlob(new Blob(['PRIVATE LOCAL CONTENT']), 'private-local-name.csv',
      { source: 'zone', kind: 'sample', format: 'CSV' })
      .then(() => ({ ok: true }), (e) => ({ error: e.message }));
  });
}

test('unconfirmed acceptance never creates a Blob URL or clicks an anchor', async ({ page }) => {
  await openAdmin(page);
  await instrumentHandoff(page);
  const reports = [];
  const failures = [
    { status: 503, json: { detail: 'unavailable' } },
    { status: 200, json: {} },
    { status: 200, json: { id: 'not-a-uuid', provenance: 'browser_reported' } },
    { status: 200, json: { id: row(1).id, provenance: 'server_prepared' } },
    { status: 200, contentType: 'application/json', body: '{invalid-json' },
  ];
  for (const failure of failures) {
    await page.route('**/reporting/downloads/initiate', (route) => {
      reports.push(route.request().postDataJSON());
      return route.fulfill(failure);
    });
    await startLocalDownload(page);
    const outcome = await page.evaluate(() => window.pendingDownload);
    expect(outcome.error).toContain('No file was released');
    expect(outcome.error).toMatch(/Retry|retry/);
    expect(await page.evaluate(() => window.handoff)).toEqual({ creates: 0, clicks: 0, revokes: 0, fail: '' });
    await page.unroute('**/reporting/downloads/initiate');
  }
  expect(new Set(reports.map((r) => r.initiation_id)).size).toBe(1);
  for (const report of reports) {
    expect(Object.keys(report).sort()).toEqual(['format', 'initiation_id', 'kind', 'source']);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|private-local-name/);
  }
});

test('committed but lost acknowledgement deduplicates retries; acknowledged handoff failures are new initiations', async ({ page }) => {
  await openAdmin(page);
  await instrumentHandoff(page);
  const baseline = (await history(page)).total;
  const reports = [];
  let held;
  await page.route('**/reporting/downloads/initiate', async (route) => {
    reports.push(route.request().postDataJSON());
    const response = await route.fetch(); // real isolated transaction commits first
    held = { route, response };
  });
  await startLocalDownload(page);
  await expect.poll(() => !!held).toBe(true);
  const firstEvidence = await held.response.json();
  expect(firstEvidence.provenance).toBe('browser_reported');
  expect((await history(page)).total).toBe(baseline + 1);
  expect(await page.evaluate(() => window.handoff.creates)).toBe(0);
  expect(await page.evaluate(() => window.handoff.clicks)).toBe(0);
  await held.route.abort('failed'); // transaction committed, browser saw no acceptance
  expect((await page.evaluate(() => window.pendingDownload)).error).toContain('No file was released');
  held = null;
  await startLocalDownload(page);
  await expect.poll(() => !!held).toBe(true);
  const retryEvidence = await held.response.json();
  expect(retryEvidence.id).toBe(firstEvidence.id);
  const duplicate = await page.evaluate(async () => {
    try {
      await (await import('/src/services/downloads.js')).downloadCSV('another', 'another.csv', 'zone', 'sample');
    } catch (e) { return e.message; }
  });
  expect(duplicate).toContain('already being prepared');
  expect(reports).toHaveLength(2);
  expect(reports[0].initiation_id).toBe(reports[1].initiation_id);
  expect(await page.evaluate(() => window.handoff.creates)).toBe(0);
  const event = page.waitForEvent('download');
  await held.route.fulfill({ response: held.response });
  expect(await page.evaluate(() => window.pendingDownload)).toEqual({ ok: true });
  // This is browser automation evidence of handoff, not proof of a user's disk save.
  expect((await event).suggestedFilename()).toBe('private-local-name.csv');
  expect((await history(page)).total).toBe(baseline + 1);
  await page.unroute('**/reporting/downloads/initiate');

  for (const failure of ['url', 'click']) {
    await page.evaluate((failure) => { window.handoff.fail = failure; }, failure);
    await startLocalDownload(page);
    const outcome = await page.evaluate(() => window.pendingDownload);
    expect(outcome.error).toContain('Initiation was recorded');
    expect(outcome.error).toContain('Retry to initiate another download');
    expect(outcome.error).not.toContain('Sign in'); // a browser refusal is not a session failure
    expect(await page.locator('a[download]').count()).toBe(0);
  }
  expect((await history(page)).total).toBe(baseline + 3);
  // Both the successful anchor and the refused click must release their object URLs.
  await expect.poll(() => page.evaluate(() => window.handoff.revokes)).toBe(2);
  await page.evaluate(() => { window.handoff.fail = ''; });
  const repeat = page.waitForEvent('download');
  await startLocalDownload(page);
  expect(await page.evaluate(() => window.pendingDownload)).toEqual({ ok: true });
  await repeat;
  const recorded = await history(page);
  expect(recorded.total).toBe(baseline + 4);
  expect(recorded.items.slice(0, 4).every((r) => r.provenance === 'browser_reported')).toBe(true);
  expect(JSON.stringify(recorded)).not.toMatch(/PRIVATE LOCAL CONTENT|private-local-name/);
});

test('server exports require server evidence and never report a browser initiation', async ({ page }) => {
  await openAdmin(page);
  await instrumentHandoff(page);
  const baseline = (await history(page)).total;
  const starts = [];
  let browserReports = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/downloads/initiate')) browserReports++;
  });
  let headerMode = 'missing';
  await page.route('**/admin/zones/export*', async (route) => {
    starts.push(route.request().headers()['x-download-initiation']);
    const response = await route.fetch();
    const headers = response.headers();
    if (headerMode === 'missing') delete headers['x-download-log'];
    if (headerMode === 'invalid') headers['x-download-log'] = 'not-an-acceptance';
    await route.fulfill({ response, headers });
  });
  for (const mode of ['missing', 'invalid']) {
    headerMode = mode;
    const failure = await page.evaluate(async () => {
      try {
        const { exportZones, downloadZoneFile } = await import('/src/services/serverZones.js');
        downloadZoneFile(await exportZones({}, 'csv'), 'csv');
      } catch (e) { return e.message; }
    });
    expect(failure).toContain('No file was released');
    expect(failure).toContain('Retry');
  }
  expect(starts[0]).toBe(starts[1]);
  expect(await page.evaluate(() => window.handoff.creates)).toBe(0);
  const forged = await page.evaluate(async () => {
    try { (await import('/src/services/downloads.js')).downloadServerBlob(new Blob(['fake']), 'fake.csv'); }
    catch (e) { return e.message; }
  });
  expect(forged).toContain('Server download acceptance is missing');
  headerMode = 'valid';
  const event = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { exportZones, downloadZoneFile } = await import('/src/services/serverZones.js');
    window.serverBlob = await exportZones({}, 'csv');
    downloadZoneFile(window.serverBlob, 'csv');
  });
  expect((await event).suggestedFilename()).toBe('evexia-zone-master.csv');
  expect(new Set(starts).size).toBe(1);
  const reused = await page.evaluate(async () => {
    try { (await import('/src/services/downloads.js')).downloadServerBlob(window.serverBlob, 'again.csv'); }
    catch (e) { return e.message; }
  });
  expect(reused).toContain('acceptance is missing');
  expect(browserReports).toBe(0);
  const recorded = await history(page);
  expect(recorded.total).toBe(baseline + 1);
  expect(recorded.items[0].provenance).toBe('server_prepared');
});

for (const cancellation of ['abort', 'logout']) {
test(`${cancellation} while awaiting acceptance cannot hand a file to the browser`, async ({ page }) => {
  await openAdmin(page);
  await instrumentHandoff(page);
  let held;
  await page.route('**/reporting/downloads/initiate', async (route) => {
    const response = await route.fetch();
    held = { route, response };
  });
  await page.evaluate(async () => {
    window.downloadAbort = new AbortController();
    window.pendingDownload = (await import('/src/services/downloads.js')).downloadBlob(new Blob(['sample']), 'sample.csv',
      { source: 'zone', kind: 'sample', format: 'CSV' }, { signal: window.downloadAbort.signal })
      .then(() => ({ ok: true }), (e) => ({ error: e.message }));
  });
  await expect.poll(() => !!held).toBe(true);
  if (cancellation === 'abort') await page.evaluate(() => window.downloadAbort.abort());
  else await page.evaluate(async () => (await import('/src/auth/adminSession.js')).logoutAdmin());
  await held.route.fulfill({ response: held.response });
  expect((await page.evaluate(() => window.pendingDownload)).error).toContain('No file was released');
  expect(await page.evaluate(() => window.handoff.creates)).toBe(0);
  expect(await page.evaluate(() => window.handoff.clicks)).toBe(0);
});
}

for (const appearance of ['light', 'dark']) {
for (const width of [1440, 390]) {
test(`Download Logs navigation, filters and table at ${width}px in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((appearance) => {
    localStorage.setItem('evexia.admin.appearance', appearance);
  }, appearance);
  const seen = [];
  let failSearch = true;
  await page.route('**/reporting/users*', (route) => route.fulfill({ json: { items: [row(1).user], total: 1, limit: 8, offset: 0, has_more: false } }));
  await page.route('**/reporting/downloads*', async (route) => {
    const u = new URL(route.request().url());
    seen.push(u);
    const offset = Number(u.searchParams.get('offset') || 0);
    if (u.searchParams.get('q') === 'nothing') return route.fulfill({ json: { items: [], total: 0, limit: 25, offset, has_more: false } });
    if (u.searchParams.get('q') === 'boom' && failSearch) return route.fulfill({ status: 500, json: { detail: 'x' } });
    const items = Array.from({ length: Math.min(25, 60 - offset) }, (_, i) => row(offset + i + 1, i % 2 ? 'browser_reported' : 'server_prepared'));
    return route.fulfill({ json: { items, total: 60, limit: 25, offset, has_more: offset + 25 < 60 } });
  });
  await authenticateAdmin(page);
  await page.goto(`${base()}/admin`);
  await page.getByTestId('button-admin-profile').click();
  await page.getByTestId('link-admin-download-logs').click();
  await expect(page).toHaveURL(/\/admin\/download-logs$/);
  await expect(page.getByRole('heading', { name: 'Download Logs' })).toBeVisible();
  await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
  await expect(page.getByText(/Neither confirms the file finished saving/)).toBeVisible();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first().locator('td').first()).toHaveText('1');
  await expect(page.getByText('Browser-reported handoff').first()).toBeVisible();
  await expect(page.getByTestId('table-download-logs').locator('th')).toHaveText(['Sr No', 'Initiated', 'User', 'Download', 'Format', 'Recorded by']);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first()).toContainText('Report 26');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first()).toContainText('Report 26');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first()).toContainText('Report 1');

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first().locator('td').first()).toHaveText('26');
  expect(seen.some((u) => u.searchParams.get('offset') === '25')).toBe(true);

  await page.getByTestId('button-download-filters').click();
  await expect(page.getByTestId('button-download-filters')).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('button-download-user').click();
  await page.getByTestId('input-download-user-search').fill('Synthetic');
  await page.getByTestId('option-download-user').click();
  await page.getByTestId('input-download-start').fill('2030-02-02');
  await page.getByTestId('input-download-end').fill('2030-02-01');
  await page.getByTestId('button-download-apply').click();
  await expect(page.getByTestId('status-download-filter-error')).toHaveText('End date cannot be before start date.');
  await page.getByTestId('input-download-end').fill('2030-02-02');
  await page.getByTestId('select-download-format').selectOption('XLSX');
  await page.getByTestId('button-download-apply').click();
  await expect.poll(() => seen.some((u) => u.searchParams.get('start') === '2030-02-02T00:00:00Z' && u.searchParams.get('end') === '2030-02-03T00:00:00Z' && u.searchParams.get('format') === 'XLSX' && u.searchParams.get('user_id') === row(1).user.id && u.searchParams.get('offset') === '0')).toBe(true);
  await expect(page.getByTestId('table-download-logs').locator('tbody tr').first().locator('td').first()).toHaveText('1');
  // Overflow must stay within the keyboard-focusable table region, not the page.
  const results = page.getByRole('region', { name: 'Results', exact: true });
  await expect(results).toHaveAttribute('tabindex', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (width === 390) {
    expect(await results.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await results.focus();
    await expect(results).toBeFocused();
    await results.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    expect(await results.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  }
  for (const id of ['input-download-search', 'button-download-apply', 'button-download-reset']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({ path: testInfo.outputPath(`download-logs-${appearance}-${width}.png`), fullPage: true });

  await page.getByTestId('input-download-search').fill('nothing');
  await expect(page.getByTestId('status-download-empty')).toBeVisible();
  await page.getByTestId('input-download-search').fill('boom');
  await expect(page.getByTestId('status-download-error')).toBeVisible();
  await expect(page.getByTestId('status-download-error')).toContainText('Check your connection and retry');
  failSearch = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('table-download-logs').locator('tbody tr')).toHaveCount(25);
  await page.getByTestId('button-download-reset').click();
  await expect(page.getByTestId('input-download-search')).toHaveValue('');
  await expect(page.getByTestId('select-download-format')).toHaveValue('');
  await expect(page.getByTestId('input-download-start')).toHaveValue('');
  await expect(page.getByTestId('input-download-end')).toHaveValue('');
  await expect(page.getByTestId('button-download-user')).toHaveText('All users');
  await expect.poll(() => seen.at(-1).searchParams.size).toBe(2); // limit and offset only
  const beforeRefresh = seen.length;
  await page.getByTestId('button-download-refresh').click();
  await expect.poll(() => seen.length).toBeGreaterThan(beforeRefresh);
});
}
}

// Exercise each handoff with a fresh trusted click, as the real download UI does.
// Consecutive page.evaluate downloads have no user gesture and can hit Chromium's
// automatic-download protection even when every file and ledger write succeeds.
async function userInitiatedFixtureDownload(page, request) {
  await page.evaluate((request) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'button-fixture-download';
    button.dataset.result = 'idle';
    button.textContent = request.format ? `Download ${request.format} test sample`
      : `Download ${request.template} ${request.family} test PDF`;
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.dataset.result = 'pending';
      try {
        if (request.format) {
          const { downloadBlob } = await import('/src/services/downloads.js');
          const { sampleExcel } = await import('/src/services/mockExcelImport.js');
          const blob = request.format === 'XLSX' ? sampleExcel('zone')
            : new Blob(['Zone Name,Status\r\nSample,Active\r\n']);
          await downloadBlob(blob, `zone.${request.format.toLowerCase()}`,
            { source: 'zone', kind: 'sample', format: request.format });
        } else if (request.family === 'po') {
          const document = (await import('/src/services/poInvoiceTemplates.js')).makeSampleInvoiceDocument(request.template);
          await (await import('/src/services/poInvoicePdf.js')).downloadInvoiceDocument(document, 'sample.pdf', '/images/evexia-logo.png');
        } else {
          const { makeSamplePRDocument, downloadPRDocument } = await import('/src/services/prDocuments.js');
          await downloadPRDocument(makeSamplePRDocument(request.template), 'sample.pdf', '/images/evexia-logo.png',
            { format: request.family });
        }
        button.dataset.result = 'success';
      } catch (error) {
        button.dataset.result = 'failed';
        button.textContent = `Download failed: ${error.message}`;
      }
    }, { once: true });
    document.body.appendChild(button);
  }, request);
  const button = page.getByTestId('button-fixture-download');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    (async () => {
      await button.click();
      await expect(button).toHaveAttribute('data-result', 'success', { timeout: 45000 });
    })(),
  ]);
  await button.evaluate((element) => element.remove());
  return download;
}

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
    const downloaded = await userInitiatedFixtureDownload(page, { format });
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
      const downloaded = await userInitiatedFixtureDownload(page, { template, family });
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
