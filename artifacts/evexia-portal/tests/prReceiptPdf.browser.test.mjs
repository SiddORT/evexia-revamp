import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Focused document check, not a data-changing user journey. Requires a running
// portal, Chromium, pdftotext and pdftoppm. No receipt records are stored.
test('downloaded receipt text is searchable and image-identical to every preview page', {
  skip: !process.env.EVEXIA_PREVIEW_BASE_URL, timeout: 120000,
}, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
  const temp = mkdtempSync(join(tmpdir(), 'pr-pdf-'));
  try {
    const page = await browser.newPage();
    const base = process.env.EVEXIA_PREVIEW_BASE_URL;
    const requests = [];
    page.on('request', (request) => requests.push(request));
    await page.goto(base);
    await page.evaluate(async () => {
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
      window.receiptPdfTestDocument = makePRDocument(model, 'classic');
    });
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
    const error = await page.evaluate(async () => {
      const { makePRDocument, downloadPRDocument } = await import('/src/services/prDocuments.js');
      const model = { ...window.receiptPdfTestDocument.model, vendorName: 'Unsupported हिंदी' };
      try {
        await downloadPRDocument(makePRDocument(model, 'classic'), '', '/images/evexia-logo.png');
      } catch (cause) { return cause.message; }
    });
    assert.match(error, /does not support.*U\+.*Image-only PDF/);
    assert.equal(logoRequests(), before, 'unsupported text must fail before logo loading or downloading');
    assert.ok(requests.every((request) => new URL(request.url()).origin === new URL(base).origin));
    assert.ok(requests.every((request) => request.method() === 'GET'), 'receipt data never leaves the browser');
  } finally {
    await browser.close();
    rmSync(temp, { recursive: true, force: true });
  }
});