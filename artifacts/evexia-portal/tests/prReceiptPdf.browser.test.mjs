import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Focused document check, not a data-changing user journey. Requires a running
// portal, Chromium, pdftotext and pdftoppm. No receipt records are stored.
for (const templateId of ['classic', 'modern', 'compact']) {
test(`${templateId}: downloaded receipt text is searchable and image-identical to every preview page`, {
  skip: !process.env.EVEXIA_PREVIEW_BASE_URL, timeout: 180000,
}, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
  const temp = mkdtempSync(join(tmpdir(), 'pr-pdf-'));
  try {
    const page = await browser.newPage();
    const base = process.env.EVEXIA_PREVIEW_BASE_URL;
    const requests = [];
    // Isolate the on-device exporter from unrelated app-shell webfont loading,
    // while keeping imports and logo fetches on the real preview origin.
    await page.route('**/*', (route) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
      : route.continue());
    await page.goto(base, { waitUntil: 'networkidle' });
    page.on('request', (request) => requests.push(request));
    await page.evaluate(async (templateId) => {
      const { makeSamplePRDocument, makePRDocument } = await import('/src/services/prDocuments.js');
      const sample = makeSamplePRDocument();
      const model = {
        ...sample.model, number: 'PR-COPY-001', status: 'deleted', deletedAt: '2026-10-01',
        vendorName: 'Café & <Saved Supplier>', receivedBy: 'Receiver "Quoted" (saved)',
        lines: Array.from({ length: 36 }, (_, i) => ({
          ...sample.model.lines[0], lineId: `source-${i + 1}`,
          productName: `Product ${i + 1} ${'long description '.repeat(3)}`,
          batchNo: `BATCH-${i + 1}-${'LOT'.repeat(12)}`,
          orderedQty: 12.5, receivedQty: 4.125, acceptedQty: 3.5,
          rejectedQty: 0.625, balanceAfterQty: i === 0 ? null : 9,
        })),
      };
      window.receiptPdfTestDocument = makePRDocument(model, templateId);
    }, templateId);
    const bounds = await page.evaluate(() => {
      const issues = [];
      for (const [index, svg] of window.receiptPdfTestDocument.pages.entries()) {
        const holder = document.createElement('div');
        holder.innerHTML = svg.replaceAll('__EVEXIA_LOGO__', '/images/evexia-logo.png');
        holder.style.cssText = 'position:fixed;left:-10000px;top:0';
        document.body.appendChild(holder);
        for (const node of holder.querySelectorAll('text')) {
          const box = node.getBBox();
          if (box.x < 0 || box.x + box.width > 794 || box.y < 0 || box.y + box.height > 1123) {
            issues.push({ page: index + 1, text: node.textContent, box: [box.x, box.y, box.width, box.height] });
          }
        }
        holder.remove();
      }
      return issues;
    });
    assert.deepEqual(bounds, [], 'all rendered text must stay on the A4 page');
    const download = async (format) => {
      const pending = page.waitForEvent('download');
      pending.catch(() => {}); // Preserve the generation error if no download starts.
      await page.evaluate(async (format) => {
        const { downloadPRDocument } = await import('/src/services/prDocuments.js');
        await downloadPRDocument(window.receiptPdfTestDocument, '', '/images/evexia-logo.png', { format });
      }, format);
      const result = await pending;
      assert.equal(result.suggestedFilename(), 'purchase-received-PR-COPY-001.pdf');
      const path = join(temp, `${format}.pdf`);
      await result.saveAs(path);
      return path;
    };
    const searchable = await download('searchable');
    const image = await download('image');
    const text = execFileSync('pdftotext', ['-layout', searchable, '-'], { encoding: 'utf8' });
    for (const value of ['PR-COPY-001', 'Café & <Saved Supplier>', 'Receiver "Quoted" (saved)',
      '4.125', '3.5', '0.625', 'DELETED', 'SAMPLE', 'LOCAL DEMO', 'unavailable',
      'Product 36', 'source-36', 'BATCH-36', 'Authorised Signatory',
      'Ordered', 'Received', 'Accepted', 'Balance', 'Rejected', '—']) {
      assert.ok(text.includes(value), `Extracted PDF must include ${value}`);
    }
    const pages = await page.evaluate(() => window.receiptPdfTestDocument.pages.length);
    assert.ok(pages > 1);
    for (let i = 1; i <= pages; i++) assert.ok(text.includes(`Page ${i} of ${pages}`));
    assert.equal(execFileSync('pdftotext', [image, '-'], { encoding: 'utf8' }).trim(), '');
    for (const [name, path] of [['searchable', searchable], ['image', image]]) {
      execFileSync('pdftoppm', ['-scale-to', '794', '-png', path, join(temp, name)], { stdio: 'pipe' });
    }
    const pictures = readdirSync(temp).filter((name) => /^searchable-\d+\.png$/.test(name));
    assert.equal(pictures.length, pages);
    for (const picture of pictures) {
      assert.deepEqual(readFileSync(join(temp, picture)), readFileSync(join(temp, picture.replace('searchable-', 'image-'))));
    }
    const logoRequests = () => requests.filter((request) => new URL(request.url()).pathname === '/images/evexia-logo.png').length;
    const before = logoRequests();
    const error = await page.evaluate(async (templateId) => {
      const { makePRDocument, downloadPRDocument } = await import('/src/services/prDocuments.js');
      const model = { ...window.receiptPdfTestDocument.model, vendorName: 'Unsupported हिंदी' };
      try {
        await downloadPRDocument(makePRDocument(model, templateId), '', '/images/evexia-logo.png');
      } catch (cause) { return cause.message; }
    }, templateId);
    assert.match(error, /does not support.*U\+.*Image-only PDF/);
    assert.equal(logoRequests(), before, 'unsupported text must fail before logo loading or downloading');
    assert.ok(requests.every((request) => new URL(request.url()).origin === new URL(base).origin));
    assert.ok(requests.every((request) => request.method() === 'GET'), 'receipt data never leaves the browser');
  } finally {
    await browser.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
}

test('Modern and Compact keep long wide receipt fields within A4 and their metadata/table cells', {
  skip: !process.env.EVEXIA_PREVIEW_BASE_URL, timeout: 60000,
}, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
      : route.continue());
    await page.goto(process.env.EVEXIA_PREVIEW_BASE_URL);
    const issues = await page.evaluate(async () => {
      const { makeSamplePRDocument, makePRDocument } = await import('/src/services/prDocuments.js');
      const sample = makeSamplePRDocument().model;
      const issues = [];
      for (const templateId of ['modern', 'compact']) {
        const doc = makePRDocument({
          ...sample, number: `PR-${'W'.repeat(180)}`, vendorAddress: 'W'.repeat(1500),
          receivedBy: 'W'.repeat(500),
          lines: [{ ...sample.lines[0], productName: 'W'.repeat(1000), batchNo: 'W'.repeat(500) }],
        }, templateId);
        for (const [index, svg] of doc.pages.entries()) {
          const holder = document.createElement('div');
          holder.innerHTML = svg.replaceAll('__EVEXIA_LOGO__', '/images/evexia-logo.png');
          document.body.appendChild(holder);
          for (const node of holder.querySelectorAll('text')) {
            const box = node.getBBox();
            if (box.x < 0 || box.x + box.width > 794 || box.y < 0 || box.y + box.height > 1123) {
              issues.push(`${templateId} page ${index + 1}: A4 bounds: ${node.textContent}`);
            }
            if (!/^W+$/.test(node.textContent)) continue;
            const x = Number(node.getAttribute('x'));
            // Metadata fields own a rectangle; table rows own vertical dividers.
            const rectangles = Array.from(holder.querySelectorAll('rect')).map((rect) => rect.getBBox())
              .filter((rect) => rect.width < 794 && rect.x <= x && rect.x + rect.width >= x &&
                rect.y <= box.y && rect.y + rect.height >= box.y + box.height);
            const rect = rectangles.sort((a, b) => a.width - b.width)[0];
            // Wrapped identification in the page header has no panel or cell.
            if (!rect) continue;
            const dividers = Array.from(holder.querySelectorAll('line'))
              .filter((line) => line.getAttribute('x1') === line.getAttribute('x2') &&
                Number(line.getAttribute('y1')) <= box.y &&
                Number(line.getAttribute('y2')) >= box.y + box.height)
              .map((line) => Number(line.getAttribute('x1')));
            const left = Math.max(rect.x, ...dividers.filter((edge) => edge <= x));
            const right = Math.min(rect.x + rect.width, ...dividers.filter((edge) => edge > x));
            if (box.x < left - 0.1 || box.x + box.width > right + 0.1) {
              issues.push(`${templateId} page ${index + 1}: cell bounds: ${node.textContent}`);
            }
          }
          holder.remove();
        }
      }
      return issues;
    });
    assert.deepEqual(issues, []);
  } finally { await browser.close(); }
});