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

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function assertShapesStayWithinPage(svg, message) {
  for (const shape of svg.matchAll(/<rect\b[^>]*\bx="([\d.]+)"[^>]*\bwidth="([\d.]+)"/g)) {
    assert.ok(Number(shape[1]) + Number(shape[2]) <= 794, `${message}: rect fits A4 width`);
  }
  for (const shape of svg.matchAll(/<line\b[^>]*\bx2="([\d.]+)"/g)) {
    assert.ok(Number(shape[1]) <= 794, `${message}: line fits A4 width`);
  }
}

function assertWideTokenLinesFit(svg, templateId) {
  const margin = templateId === 'modern' ? 44 : 38;
  const contentWidth = 794 - margin * 2;
  const scale = contentWidth / 706;
  const limits = {
    header: Math.floor((contentWidth - 180) / ((templateId === 'modern' ? 8.8 : 8.2) * 1.075)),
    metadataLeft: Math.floor((templateId === 'modern' ? 300 : 306) /
      ((templateId === 'modern' ? 9.3 : 8.2) * 1.075)),
    metadataRight: Math.floor((templateId === 'modern' ? 330 : 336) /
      ((templateId === 'modern' ? 9.3 : 8.2) * 1.075)),
    mainProduct: Math.floor((198 * scale - 10) / ((templateId === 'modern' ? 9 : 8.2) * 1.075)),
    traceProduct: Math.floor((190 * scale - 10) / ((templateId === 'modern' ? 9 : 8.2) * 1.075)),
    batch: Math.floor((140 * scale - 10) / ((templateId === 'modern' ? 9 : 8.2) * 1.075)),
  };
  const seen = new Set();
  for (const match of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const x = Number(match[1].match(/\bx="([\d.]+)"/)?.[1]);
    const fontSize = Number(match[1].match(/\bfont-size="([\d.]+)"/)?.[1]);
    const value = match[2];
    const wideTokens = [...value.matchAll(/W+/g)].map((token) => token[0]);
    if (!wideTokens.length) continue;
    let category;
    let width;
    if (x > 700) {
      category = 'header';
      width = contentWidth - 180;
    } else if (x < 70) {
      category = 'metadataLeft';
      width = templateId === 'modern' ? 300 : 306;
    } else if (x > 380 && x < 450) {
      category = 'metadataRight';
      width = templateId === 'modern' ? 330 : 336;
    } else if (x > 75 && x < 150) {
      category = 'mainProduct';
      width = 198 * scale - 10;
    } else if (x > 170 && x < 250) {
      category = 'traceProduct';
      width = 190 * scale - 10;
    } else if (x > 450 && x < 550) {
      category = 'batch';
      width = 140 * scale - 10;
    } else {
      continue;
    }
    seen.add(category);
    const maxTokenLength = Math.floor(width / (fontSize * 1.075));
    for (const token of wideTokens) {
      assert.ok(token.length <= maxTokenLength, `${templateId} ${category} token fits its actual text column`);
      assert.ok(token.length <= limits[category], `${templateId} ${category} uses conservative font-width wrapping`);
    }
  }
  for (const category of Object.keys(limits)) {
    assert.ok(seen.has(category), `${templateId}: wide-token test covers ${category}`);
  }
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
  assert.throws(() => renderPRReceiptPages(model(), 'unknown'), /Unsupported Purchase Received template/);
  assert.throws(() => renderPRReceiptPages(null), /saved Purchase Received document model/);
  assert.throws(() => renderPRReceiptPages(model({ lines: null })), /lines must be an array/);
  assert.throws(() => renderPRReceiptPages(model({ lines: [null] })), /line 1 is invalid/);
});

for (const templateId of ['classic', 'modern', 'compact']) {
  test(`renders ${templateId} with saved receipt semantics, traceability, and unsigned final certification`, () => {
    const pages = renderPRReceiptPages(model({
      lines: [
        line(1, { lineId: 'duplicate-source', productName: 'Repeated source product', receivedQty: 2.375, acceptedQty: 2.125 }),
        line(2, { lineId: 'duplicate-source', productName: 'Repeated source product', receivedQty: 1.625, acceptedQty: 1.5 }),
      ],
    }), templateId);
    const svg = pages.join('');
    const text = textOnPages(pages);

    assert.match(svg, /href="__EVEXIA_LOGO__"/);
    assert.ok(text.includes('Saved Vendor'));
    assert.ok(text.includes('duplicate-source'));
    assert.equal(occurrences(text, 'Repeated source product'), 4, 'both duplicate source rows remain distinct in quantity and traceability sections');
    assert.ok(text.includes('2.375'));
    assert.ok(text.includes('2.125'));
    assert.ok(text.includes('1.625'));
    assert.ok(text.includes('1.5'));
    assert.ok(text.includes('Certified that the particulars given above are true and correct.'));
    assert.ok(text.includes('UNSIGNED · SIGNATURE PLACEHOLDER'));
    assert.ok(text.includes('Authorised Signatory'));
    for (const page of pages) assertShapesStayWithinPage(page, templateId);
    if (templateId === 'modern') {
      assert.match(svg, /fill="#183c60"/);
      assert.match(svg, /fill="#e9f1f8"/);
    } else if (templateId === 'compact') {
      assert.match(svg, /fill="#087c78"/);
      assert.match(svg, /fill="#e4f3f1"/);
    } else {
      assert.match(svg, /<line x1="44" y1="119"/);
    }
  });

  test(`${templateId} retains demo, deleted, sample, and missing-balance markings`, () => {
    const pages = renderPRReceiptPages(model({
      status: 'deleted',
      deletedAt: '2026-02-09T10:00:00.000Z',
      isSample: true,
      lines: [line(1, { balanceAfterQty: null })],
    }), templateId);
    const text = textOnPages(pages);

    assert.ok(text.includes('LOCAL DEMO · NOT A STOCK-LEDGER ENTRY'));
    assert.ok(text.includes('DELETED · FOR REFERENCE'));
    assert.ok(text.includes('SAMPLE · PREVIEW ONLY'));
    assert.ok(text.includes('Balance Qty is unavailable for legacy history'));
    assert.ok(text.includes('no after-receipt quantity was saved'));
  });

  test(`${templateId} wraps long header identifiers and escaped long fields without clipping`, () => {
    const longId = `LONG-${'PRPO-ID-'.repeat(34)}-END`;
    const unsafe = '<script>alert("saved receipt")</script> & supplier';
    const pages = renderPRReceiptPages(model({
      number: longId,
      poNumber: `PO-${longId}`,
      vendorName: unsafe,
      vendorAddress: `ADDRESS-START ${'long-fragment-'.repeat(70)} ADDRESS-END`,
      receivedBy: `RECEIVER-START ${'receiver-fragment-'.repeat(54)} RECEIVER-END`,
      lines: [line(1, {
        productName: unsafe,
        batchNo: `BATCH-${'escaped-fragment-'.repeat(50)}`,
      })],
    }), templateId);
    const allSvg = pages.join('');
    const visible = textOnPages(pages);
    const withoutWhitespace = visible.replaceAll(/\s+/g, '');

    assert.ok(pages.length > 1, `${templateId}: long saved fields paginate`);
    assert.match(allSvg, /&lt;script&gt;alert\(&quot;saved receipt&quot;\)&lt;\/script&gt; &amp; supplier/);
    assert.doesNotMatch(allSvg, /<script>/);
    assert.ok(visible.includes('ADDRESS-START'));
    assert.ok(visible.includes('ADDRESS-END'));
    assert.ok(visible.includes('RECEIVER-START'));
    assert.ok(visible.includes('RECEIVER-END'));
    assert.ok(withoutWhitespace.includes(longId.replaceAll(/\s+/g, '')));
    assert.ok(withoutWhitespace.includes(unsafe.replaceAll(/\s+/g, '')));
    for (const page of pages) assertShapesStayWithinPage(page, templateId);
    if (templateId !== 'classic') {
      const headerLines = [...pages[0].matchAll(/<text x="(750|756)" y="[\d.]+"[^>]*>([^<]+)<\/text>/g)]
        .map((match) => match[2]);
      assert.ok(headerLines.length > 1, `${templateId}: long PR/PO IDs wrap into separate header lines`);
      const labelLines = [...allSvg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
        .map((match) => match[1]);
      assert.ok(labelLines.includes('independently verified)'), `${templateId}: long receiver metadata label wraps to a separate visible line`);
    }
  });

  test(`${templateId} paginates dense rows, repeats seven columns, preserves missing balances and final signatory`, () => {
    const records = Array.from({ length: 96 }, (_, index) => line(index + 1, {
      lineId: index % 2 ? 'shared-source-line' : `source-line-${index + 1}`,
      productName: `Dense receipt item ${String(index + 1).padStart(3, '0')}`,
      orderedQty: index + 0.125,
      receivedQty: index + 0.062,
      acceptedQty: index + 0.031,
      rejectedQty: 0.015,
      balanceAfterQty: index === 7 ? null : index + 0.062,
    }));
    const pages = renderPRReceiptPages(model({ lines: records }), templateId);
    const wholeText = textOnPages(pages);

    assert.ok(pages.length > 2);
    assert.ok(wholeText.includes('Balance Qty is unavailable for legacy history'));
    assert.ok(wholeText.includes('—'));
    assert.ok(wholeText.includes('0.015'));
    for (let index = 1; index <= records.length; index += 1) {
      const name = `Dense receipt item ${String(index).padStart(3, '0')}`;
      assert.equal(occurrences(wholeText, name), 2, `${templateId}: row ${index} appears in both quantity and traceability tables`);
    }
    for (const [index, page] of pages.entries()) {
      assert.match(page, new RegExp(`Page ${index + 1} of ${pages.length}`));
      assertShapesStayWithinPage(page, `${templateId} page ${index + 1}`);
    }
    assert.match(pages.at(-1), /Authorised Signatory/);
    assert.ok(pages.slice(0, -1).every((page) => !page.includes('Authorised Signatory')));
  });
}

for (const templateId of ['modern', 'compact']) {
  test(`${templateId} conservatively wraps wide unbroken W tokens within header, metadata, and table cells`, () => {
    const number = `PR-${'W'.repeat(180)}`;
    const poNumber = `PO-${'W'.repeat(160)}`;
    const vendorAddress = 'W'.repeat(1500);
    const receivedBy = 'W'.repeat(500);
    const productName = 'W'.repeat(1000);
    const batchNo = 'W'.repeat(500);
    const pages = renderPRReceiptPages(model({
      number,
      poNumber,
      vendorAddress,
      receivedBy,
      lines: [line(1, { productName, batchNo })],
    }), templateId);
    const allSvg = pages.join('');
    const allText = textOnPages(pages);
    const totalWideGlyphs = [...allSvg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
      .reduce((sum, match) => sum + (match[1].match(/W/g) || []).length, 0);

    assert.ok(pages.length > 1, `${templateId}: long wide-token data paginate safely`);
    assert.ok(allText.includes(number.slice(0, 8)));
    assert.ok(allText.includes(poNumber.slice(0, 8)));
    assert.ok(totalWideGlyphs >= number.length - 3 + poNumber.length - 3 +
      vendorAddress.length + receivedBy.length + productName.length * 2 + batchNo.length,
    `${templateId}: wide tokens are retained across wrapped SVG text nodes`);
    assertWideTokenLinesFit(allSvg, templateId);
    for (const page of pages) assertShapesStayWithinPage(page, `${templateId} wide-token page`);
  });
}

test('Compact has a measurably denser table than Modern', () => {
  const records = Array.from({ length: 100 }, (_, index) =>
    line(index + 1, { productName: `Density comparison item ${index + 1}` }));
  const modern = renderPRReceiptPages(model({ lines: records }), 'modern');
  const compact = renderPRReceiptPages(model({ lines: records }), 'compact');
  const countFirstPageItems = (pages) =>
    [...textContent(pages[0]).matchAll(/Density comparison item \d+/g)].length;

  assert.ok(
    countFirstPageItems(compact) > countFirstPageItems(modern),
    'Compact fits more saved quantity/traceability item labels on its first page than Modern',
  );
  assert.match(compact[0], /font-size="8\.2"/);
  assert.match(modern[0], /font-size="9"/);
});