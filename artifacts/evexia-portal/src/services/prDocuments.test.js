import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPRDocument, makePRDocument, makeSamplePRDocument, prReceiptFilename } from './prDocuments.js';
import { PR_TEMPLATE_KEY, PR_TEMPLATES, setDefaultPRTemplate } from './prReceiptTemplates.js';
import { PO_TEMPLATE_KEY, loadPOTemplatePreference } from './poInvoiceTemplates.js';

test.beforeEach(() => {
  const data = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } };
});

function receipt(overrides = {}) {
  return {
    id: 'receipt-1',
    number: 'PR-2026-001',
    poId: 'po-1',
    poNumber: 'PO-2026-014',
    poDate: '2026-02-03',
    receivedDate: '2026-02-08',
    receivedBy: 'Demo Admin',
    vendorId: 'vendor-1',
    vendorName: 'Saved Vendor',
    vendorPhone: '9876543210',
    locationId: 'location-1',
    locationName: 'Main Warehouse',
    status: 'active',
    createdAt: '2026-02-08T09:00:00.000Z',
    updatedAt: '2026-02-08T09:00:00.000Z',
    deletedAt: null,
    lines: [{
      lineId: 'line-1',
      productId: 'product-1',
      productName: 'Saved Product',
      orderedQty: 12.5,
      receivedQty: 4.125,
      acceptedQty: 3.5,
      rejectedQty: 0.625,
      batchNo: 'BATCH-001',
      expiryDate: '2027-08-31',
    }],
    ...overrides,
  };
}

function textContent(document) {
  return [...document.pages.join('').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1]
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&'))
    .join('');
}

test('creates a normalized Purchase Received document from saved receipt fields', () => {
  const document = makePRDocument(receipt({
    vendor: { name: 'Must not load or replace saved vendor' },
    productMaster: { name: 'Must not load or replace saved product' },
    location: { name: 'Must not load or replace saved destination' },
  }));

  assert.equal(document.number, 'PR-2026-001');
  assert.equal(document.templateId, 'classic');
  assert.equal(document.pages.length, 1);
  assert.match(document.pages[0], /PURCHASE RECEIVED/);
  assert.match(document.pages[0], /PR-2026-001/);
  assert.match(document.pages[0], /PO-2026-014/);
  assert.match(document.pages[0], /Saved Vendor/);
  assert.match(document.pages[0], /Saved Product/);
  assert.match(document.pages[0], /Main Warehouse/);
  assert.match(document.pages[0], /4\.125/);
  assert.match(document.pages[0], /3\.5/);
  assert.match(document.pages[0], /0\.625/);
  assert.match(document.pages[0], /__EVEXIA_LOGO__/);
  assert.match(document.pages[0], /LOCAL DEMO · NOT A STOCK-LEDGER ENTRY/);
  assert.doesNotMatch(document.pages.join(''), /Must not load or replace/);
  assert.equal(document.model.lines[0].lineId, 'line-1');
  assert.equal(document.model.vendorName, 'Saved Vendor');
});

test('keeps the receipt table and every header column inside the printable A4 right edge', () => {
  const page = makePRDocument(receipt()).pages[0];
  const pageWidth = 794;
  const margin = 44;
  const header = page.match(/<rect x="44" y="([\d.]+)" width="([\d.]+)" height="38" fill="#[a-f\d]+"\/>/);

  assert.ok(header, 'receipt table header should be present');
  const tableTop = Number(header[1]);
  const tableRight = margin + Number(header[2]);
  assert.ok(tableRight <= pageWidth - margin, 'table must not extend beyond the printable A4 right edge');

  const headerColumnLines = [...page.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)]
    .filter((match) => Number(match[2]) === tableTop && Number(match[4]) === tableTop + 38);
  assert.ok(headerColumnLines.length > 0, 'table column dividers should be rendered');
  for (const line of headerColumnLines) {
    assert.ok(Number(line[1]) <= pageWidth - margin);
    assert.ok(Number(line[3]) <= pageWidth - margin);
  }
});

test('escapes untrusted receipt text in the SVG while keeping wrapped text visible', () => {
  const unsafe = `Product & <script>alert("x")</script> 'quoted' ${'verylong'.repeat(20)}`;
  const receiver = `Receiver ${'name-with-a-very-long-segment-'.repeat(14)}`;
  const document = makePRDocument(receipt({
    receivedBy: receiver,
    lines: [{
      lineId: 'line-unsafe',
      productId: 'product-unsafe',
      productName: unsafe,
      orderedQty: 2,
      receivedQty: 1,
      acceptedQty: 1,
      rejectedQty: 0,
      batchNo: `BATCH&<${'X'.repeat(90)}`,
      expiryDate: '2027-08-31',
    }],
  }));
  const allSvg = document.pages.join('');
  const renderedText = textContent(document);

  assert.match(allSvg, /&lt;script&gt;/);
  assert.match(allSvg, /alert\(&quot;x&quot;\)/);
  assert.match(allSvg, /&apos;quoted&apos;/);
  assert.doesNotMatch(allSvg, /<script>/);
  assert.ok(renderedText.includes('Product'));
  assert.ok(renderedText.includes('<script>alert("x")</script>'));
  assert.ok(renderedText.includes('verylong'.repeat(20)));
  assert.ok(renderedText.includes('Receiver'));
  // Paginated metadata inserts explicit continuation labels between fragments.
  assert.ok(renderedText.includes('name-with-a-very-long-segment-'));
  assert.ok(document.pages.length > 1);
  assert.ok(renderedText.includes('BATCH&<'));
  assert.ok(renderedText.includes('X'.repeat(90)));
});

test('wraps long batch, receiver, and product text and paginates a receipt of 100 lines', () => {
  const lines = Array.from({ length: 100 }, (_, index) => ({
    lineId: `line-${index + 1}`,
    productId: `product-${index + 1}`,
    productName: `Product ${index + 1} ${'long-name-segment '.repeat(3)}`,
    orderedQty: 100.125,
    receivedQty: 1.125,
    acceptedQty: 1,
    rejectedQty: 0.125,
    batchNo: `BATCH-${index + 1}-${'LOT'.repeat(8)}`,
    expiryDate: '2028-12-31',
  }));
  const document = makePRDocument(receipt({
    receivedBy: `Receiver ${'Long Name '.repeat(15)}`,
    lines,
  }));
  const allSvg = document.pages.join('');

  assert.ok(document.pages.length > 1);
  assert.ok(document.pages.every((page) => page.includes('__EVEXIA_LOGO__')));
  assert.match(allSvg, /Page 1 of \d+/);
  assert.ok(document.pages.every((page) => page.includes('PR-2026-001') && page.includes('PO-2026-014')));
  assert.match(textContent(document), /Product 1 long-name-segment/);
  assert.match(textContent(document), /Product 100 long-name-segment/);
  assert.match(textContent(document), /BATCH-100-LOTLOT/);
  assert.match(allSvg, /1\.125/);
  assert.match(allSvg, /0\.125/);
});

test('selected preference is required for saved receipts, samples use an explicit template', () => {
  window.localStorage.setItem(PR_TEMPLATE_KEY, '{broken');
  assert.throws(() => makePRDocument(receipt()), /unreadable/);
  assert.match(makeSamplePRDocument().pages.join(''), /SAMPLE · PREVIEW ONLY/);
  assert.throws(() => makePRDocument(receipt(), 'unknown'), /supported PR receipt/);
  assert.equal(prReceiptFilename('../PR:001/<unsafe>'), 'purchase-received-PR-001-unsafe.pdf');
  assert.equal(prReceiptFilename(null), 'purchase-received-receipt.pdf');
});

test('legacy balances remain unknown and saved balances survive later-receipt context', () => {
  const legacy = makePRDocument(receipt());
  assert.equal(legacy.model.lines[0].balanceAfterQty, null);
  assert.match(legacy.pages.join(''), /unavailable/);
  const saved = receipt();
  saved.lines[0].balanceAfterQty = 9;
  const current = makePRDocument(saved);
  assert.equal(current.model.lines[0].balanceAfterQty, 9);
  assert.deepEqual(makePRDocument({ ...saved, laterReceipts: [{ acceptedQty: 9 }] }).pages, current.pages);
  assert.match(current.pages.at(-1), /Authorised Signatory/);
  assert.doesNotMatch(current.pages.join(''), /Taxable|Unit Price|GST Amount|₹/);
});

test('marks deleted and explicitly sample receipts without changing their saved details', () => {
  const deleted = makePRDocument(receipt({ status: 'deleted', deletedAt: '2026-02-09T10:00:00.000Z' }));
  const sample = makePRDocument(receipt({ isSample: true }));

  assert.match(deleted.pages[0], /DELETED · FOR REFERENCE/);
  assert.match(sample.pages[0], /SAMPLE · PREVIEW ONLY/);
  assert.equal(deleted.model.status, 'deleted');
  assert.equal(deleted.model.deletedAt, '2026-02-09T10:00:00.000Z');
  assert.equal(sample.number, 'PR-2026-001');
});

test('rejects malformed source records and requires browser SVG measurement for searchable PDFs', async () => {
  assert.throws(() => makePRDocument(null), /saved Purchase Received record/);
  assert.throws(() => makePRDocument({ ...receipt(), lines: null }), /lines must be an array/);

  const document = makePRDocument(receipt());
  await assert.rejects(
    downloadPRDocument(document, 'PR-2026-001.pdf', '/images/evexia-logo.png'),
    /browser with SVG text measurement/,
  );
  await assert.rejects(
    downloadPRDocument(document, '', '/images/evexia-logo.png', { format: 'image' }),
    /browser page with a same-origin logo URL/,
  );
  await assert.rejects(
    downloadPRDocument(document, '', '/images/evexia-logo.png', { format: 'unknown' }),
    /Choose Searchable PDF/,
  );
  await assert.rejects(
    downloadPRDocument({ pages: [] }, 'PR.pdf', '/images/evexia-logo.png'),
    /document pages are missing/,
  );
});

for (const templateId of ['classic', 'modern', 'compact']) {
  test(`${templateId}: saved preview follows the independent default without changing receipt values`, () => {
    window.localStorage.setItem(PO_TEMPLATE_KEY, JSON.stringify({
      version: 1, defaultPOInvoiceTemplate: 'modern',
    }));
    const saved = receipt();
    saved.lines[0].balanceAfterQty = 9;
    saved.lines.push({
      ...saved.lines[0], lineId: 'duplicate-source-2', balanceAfterQty: null,
      batchNo: 'SECOND-BATCH',
    });
    const before = JSON.stringify(saved);
    setDefaultPRTemplate(templateId);
    const document = makePRDocument(saved);
    assert.equal(document.templateId, templateId);
    assert.equal(loadPOTemplatePreference(), 'modern');
    assert.deepEqual(document.pages, makePRDocument(saved, templateId).pages);
    assert.equal(JSON.stringify(saved), before);
    assert.deepEqual(document.model.lines.map((line) => line.balanceAfterQty), [9, null]);
    assert.deepEqual(document.model.lines.map((line) => line.lineId), ['line-1', 'duplicate-source-2']);
    const text = textContent(document);
    for (const value of ['4.125', '0.625', 'SECOND-BATCH', 'duplicate-source-2', 'unavailable']) {
      assert.ok(text.includes(value), value);
    }
    assert.doesNotMatch(text, /Unit Price|Taxable Amount|GST Amount|₹/);
    assert.ok(document.pages.at(-1).includes('Authorised Signatory'));
  });

  test(`${templateId}: both export options retain explicit errors and supported-template validation`, async () => {
    const document = makePRDocument(receipt(), templateId);
    await assert.rejects(downloadPRDocument(document, '', '/images/evexia-logo.png'),
      /browser with SVG text measurement/);
    await assert.rejects(downloadPRDocument(document, '', '/images/evexia-logo.png', { format: 'image' }),
      /browser page with a same-origin logo URL/);
    await assert.rejects(downloadPRDocument({ ...document, templateId: 'unknown' }, '', '/images/evexia-logo.png'),
      /unsupported template/);
  });
}

test('each receipt gallery theme has distinct fictional sample content without reading preferences', () => {
  window.localStorage.setItem(PR_TEMPLATE_KEY, '{broken');
  const documents = PR_TEMPLATES.map(({ id }) => makeSamplePRDocument(id));
  assert.equal(new Set(documents.map((doc) => doc.number)).size, 3);
  assert.equal(new Set(documents.map((doc) => doc.model.vendorName)).size, 3);
  for (const document of documents) {
    assert.equal(document.model.isSample, true);
    assert.ok(document.pages[0].includes('SAMPLE · PREVIEW ONLY'));
    assert.equal(document.model.hasHistoricalBalance, true);
  }
});