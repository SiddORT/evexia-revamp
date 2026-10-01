import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPRReceiptPages } from './prReceiptRender.js';

function line(index = 1, overrides = {}) {
  return {
    lineId: `source-line-${index}`,
    productName: `Saved product ${index}`,
    orderedQty: 12.5,
    receivedQty: 4.125,
    acceptedQty: 3.5,
    rejectedQty: 0.625,
    balanceAfterQty: 8.375,
    batchNo: `BATCH-${index}`,
    expiryDate: '2027-08-31',
    ...overrides,
  };
}

function model(overrides = {}) {
  return {
    number: 'PR-2026-001',
    receivedDate: '2026-02-08',
    receivedBy: 'Saved Receiver',
    poNumber: 'PO-2026-014',
    poDate: '2026-02-03',
    locationName: 'Main Warehouse',
    status: 'active',
    deletedAt: null,
    isSample: false,
    vendorName: 'Saved Vendor',
    vendorAddress: '12 Market Road',
    vendorGstNo: '27TEST1234Z5',
    vendorPhone: '9876543210',
    lines: [line()],
    ...overrides,
  };
}

function textContent(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1]
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&'))
    .join(' ');
}

function textOnPages(pages) {
  return pages.map(textContent).join(' ');
}

test('renders the Classic reference header, saved receipt metadata, seven quantity columns, and separate traceability', () => {
  const [svg] = renderPRReceiptPages(model());
  const text = textContent(svg);

  assert.match(svg, /width="794" height="1123" viewBox="0 0 794 1123"/);
  assert.match(svg, /href="__EVEXIA_LOGO__"/);
  assert.match(svg, /<line x1="44" y1="119"/);
  for (const value of [
    'EVEXIA LIFE SCIENCES PVT. LTD.',
    '2nd floor, Laud Mansion, Mumbai - 400 004',
    'info@evexialifesciences.com',
    'www.evexialifesciences.com',
    'PURCHASE RECEIVED',
    'PR-2026-001',
    'PO-2026-014',
    'Saved Vendor',
    '12 Market Road',
    '27TEST1234Z5',
    'PR Date',
    '9876543210',
    'Saved Receiver',
    'not independently verified',
    'Main Warehouse',
    'RECEIVED QUANTITY SUMMARY',
    'S.No.',
    'Product',
    'Description',
    'Ordered',
    'Received',
    'Accepted',
    'Balance',
    'Rejected',
    'RECEIPT TRACEABILITY',
    'Source',
    'Line ID',
    'BATCH-1',
    '2027-08-31',
    'LOCAL DEMO · NOT A STOCK-LEDGER ENTRY',
    'Certified that the particulars given above are true and correct.',
    'UNSIGNED · SIGNATURE PLACEHOLDER',
    'Authorised Signatory',
  ]) assert.ok(text.includes(value), `expected receipt document text: ${value}`);

  assert.match(text, /12\.5/);
  assert.match(text, /4\.125/);
  assert.match(text, /3\.5/);
  assert.match(text, /8\.375/);
  assert.match(text, /0\.625/);
  assert.doesNotMatch(text, /Unit Price|GST Amount|Taxable Amount|Gross Amount|₹/);
  assert.equal((svg.match(/>S\.No\.<\/text>/g) || []).length, 2);
  const mainHeader = svg.match(/<rect x="44" y="[\d.]+" width="([\d.]+)" height="38" fill="#f3f5f6"\/>/);
  assert.ok(mainHeader, 'the seven-column table uses the light reference-style header');
  assert.ok(Number(mainHeader[1]) <= 706, 'the main table fits inside the printable A4 width');
});

test('shows the legacy-balance explanation and exact deleted and sample markings', () => {
  const [svg] = renderPRReceiptPages(model({
    status: 'deleted',
    deletedAt: '2026-02-09T10:00:00.000Z',
    isSample: true,
    lines: [line(1, { balanceAfterQty: null })],
  }));
  const text = textContent(svg);

  assert.ok(text.includes('DELETED · FOR REFERENCE'));
  assert.ok(text.includes('SAMPLE · PREVIEW ONLY'));
  assert.ok(text.includes('Balance Qty is unavailable for legacy history'));
  assert.ok(text.includes('no after-receipt quantity was saved'));
  assert.ok(text.includes('Authorised Signatory'));
  assert.match(svg, />—<\/text>/);
});

test('escapes untrusted vendor, receiver, and product text while preserving visible wrapped content', () => {
  const unsafe = '<script>alert("receipt")</script> & supplier';
  const pages = renderPRReceiptPages(model({
    vendorName: unsafe,
    receivedBy: `Receiver ${'long-name-segment-'.repeat(18)}`,
    lines: [line(1, { productName: unsafe })],
  }));
  const allSvg = pages.join('');
  const text = textOnPages(pages);
  const compactText = text.replaceAll(/\s+/g, '');

  assert.match(allSvg, /&lt;script&gt;alert\(&quot;receipt&quot;\)&lt;\/script&gt; &amp; supplier/);
  assert.doesNotMatch(allSvg, /<script>/);
  assert.ok(text.includes(unsafe));
  assert.ok(compactText.includes('long-name-segment-'.repeat(18)));
});

test('paginates long metadata and 120 rows without clipping, repeats table headings, and reserves the final signature area', () => {
  const records = Array.from({ length: 120 }, (_, index) => line(index + 1, {
    productName: `Product ${index + 1} ${'long product description '.repeat(2)}`,
  }));
  const pages = renderPRReceiptPages(model({
    vendorAddress: `ADDRESS-START ${'address-fragment-'.repeat(190)} ADDRESS-END`,
    receivedBy: `RECEIVER-START ${'receiver-fragment-'.repeat(110)} RECEIVER-END`,
    lines: records,
  }));

  assert.ok(pages.length > 4);
  for (const [index, page] of pages.entries()) {
    assert.match(page, /width="794" height="1123" viewBox="0 0 794 1123"/);
    assert.match(page, new RegExp(`Page ${index + 1} of ${pages.length}`));
    assert.ok(page.includes('LOCAL DEMO · NOT A STOCK-LEDGER ENTRY'));
    if (page.includes('RECEIVED QUANTITY SUMMARY')) {
      for (const heading of ['Ordered', 'Received', 'Accepted', 'Balance', 'Rejected']) {
        assert.ok(textContent(page).includes(heading), `${index + 1}: ${heading} heading repeats`);
      }
      const header = page.match(/<rect x="44" y="[\d.]+" width="([\d.]+)" height="38" fill="#f3f5f6"\/>/);
      assert.ok(header, `${index + 1}: main heading bar is present`);
      assert.ok(Number(header[1]) <= 706, `${index + 1}: main table stays within A4`);
    }
    if (page.includes('RECEIPT TRACEABILITY')) {
      assert.ok(textContent(page).includes('Source'));
      assert.ok(textContent(page).includes('Expiry Date'));
    }
  }

  const wholeDocument = textOnPages(pages);
  assert.ok(wholeDocument.includes('ADDRESS-START'));
  assert.ok(wholeDocument.includes('ADDRESS-END'));
  assert.ok(wholeDocument.includes('RECEIVER-START'));
  assert.ok(wholeDocument.includes('RECEIVER-END'));
  for (let index = 1; index <= records.length; index++) {
    assert.ok(wholeDocument.includes(`Product ${index}`), `product ${index} is preserved`);
    assert.ok(wholeDocument.includes(`source-line-${index}`), `source line ${index} is preserved`);
  }

  const finalPage = pages.at(-1);
  assert.match(finalPage, /Authorised Signatory/);
  assert.match(finalPage, /height="178" fill="#ffffff"/);
  assert.ok(pages.slice(0, -1).every((page) => !page.includes('Authorised Signatory')));
  const signatureBox = finalPage.match(/<rect x="466" y="852" width="284" height="178"/);
  assert.ok(signatureBox, 'unsigned company signature placeholder stays within the final A4 page');
});

test('never drops a row at a page transition or clips supplementary columns beyond the printable edge', () => {
  const records = Array.from({ length: 120 }, (_, index) => line(index + 1, {
    productName: `Unique product ${String(index + 1).padStart(3, '0')}`,
  }));
  const pages = renderPRReceiptPages(model({ lines: records }));
  const text = textOnPages(pages);
  for (let index = 1; index <= records.length; index++) {
    const name = `Unique product ${String(index).padStart(3, '0')}`;
    assert.equal(text.split(name).length - 1, 2, `${name} occurs once in quantities and once in traceability`);
  }
  for (const page of pages) {
    for (const header of page.matchAll(/<rect x="44" y="[\d.]+" width="([\d.]+)" height="38"/g)) {
      assert.equal(Number(header[1]), 706, 'every quantity and supplementary table stays within A4 margins');
    }
  }
});

test('handles very long unbroken product and metadata values, and clearly rejects unsupported inputs', () => {
  const longAddress = `ADDRESS-${'X'.repeat(3600)}-END`;
  const longProduct = `PRODUCT-${'Y'.repeat(3100)}-END`;
  const pages = renderPRReceiptPages(model({
    vendorAddress: longAddress,
    lines: [line(1, { productName: longProduct })],
  }));
  const allSvg = pages.join('');
  const allText = textOnPages(pages);

  assert.ok(pages.length > 1);
  assert.ok(allText.includes('-END'));
  assert.ok(allText.includes('PRODUCT-'));
  assert.match(allText, /Y+-END/);
  assert.match(allSvg, /href="__EVEXIA_LOGO__"/);
  assert.throws(() => renderPRReceiptPages(model(), 'modern'), /Unsupported Purchase Received template/);
  assert.throws(() => renderPRReceiptPages(null), /saved Purchase Received document model/);
  assert.throws(() => renderPRReceiptPages(model({ lines: null })), /lines must be an array/);
  assert.throws(() => renderPRReceiptPages(model({ lines: [null] })), /line 1 is invalid/);
});