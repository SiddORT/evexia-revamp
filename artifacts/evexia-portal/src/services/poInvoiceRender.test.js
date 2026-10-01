import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPOInvoicePages } from './poInvoiceRender.js';

function makeModel(lines = []) {
  return {
    company: {
      name: 'EVEXIA LIFE SCIENCES',
      address: '2nd floor, Laud Mansion, Mumbai - 400 004',
      email: 'info@example.test',
      website: 'www.example.test',
    },
    vendor: { name: 'Supplier & Sons', address: '12 Market Road', gstNo: '27TEST1234Z5' },
    number: 'PO-20261001-00001',
    poDate: '2026-10-01',
    expectedDate: '2026-10-05',
    locationName: 'Main Warehouse',
    status: 'open',
    lines,
    subtotal: 123450,
    gstAmount: 14814,
    total: 138264,
    isSample: false,
  };
}

test('renders each supported template as A4 SVG with the same invoice details', () => {
  const line = {
    productName: 'Diagnostic reagent & buffer',
    hsnCode: '3822',
    quantity: 2,
    unitPrice: 617.25,
    gst: 12,
    subtotal: 123450,
    gstAmount: 14814,
    total: 138264,
  };
  const outputs = ['classic', 'modern', 'compact'].map((template) =>
    renderPOInvoicePages(makeModel([line]), template));

  for (const pages of outputs) {
    assert.equal(pages.length, 1);
    assert.match(pages[0], /width="794" height="1123" viewBox="0 0 794 1123"/);
    assert.match(pages[0], /href="__EVEXIA_LOGO__"/);
    for (const text of [
      'Supplier &amp; Sons', 'PO-20261001-00001', 'Diagnostic reagent &amp; buffer',
      'HSN Code', 'Purchase Qty', 'Taxable Amount', 'GST Amount', 'Authorised Signatory',
      '₹1,234.50', 'Page 1 of 1',
    ]) assert.ok(pages[0].includes(text), `expected invoice text ${text}`);
  }
  assert.notEqual(outputs[0][0], outputs[1][0]);
  assert.notEqual(outputs[1][0], outputs[2][0]);
});

test('escapes supplier input and marks deleted and sample orders explicitly', () => {
  const malicious = makeModel([]);
  malicious.vendor.name = '<svg onload="alert(1)">&';
  malicious.status = 'deleted';
  malicious.isSample = true;
  const svg = renderPOInvoicePages(malicious, 'classic')[0];
  assert.ok(svg.includes('&lt;svg onload=&quot;alert(1)&quot;&gt;&amp;'));
  assert.ok(!svg.includes('<svg onload='));
  assert.ok(svg.includes('DELETED / FOR REFERENCE'));
  assert.ok(svg.includes('SAMPLE / PREVIEW ONLY'));

  malicious.status = 'open';
  assert.ok(renderPOInvoicePages(malicious, 'modern')[0].includes('SAMPLE / PREVIEW ONLY'));
});

test('paginates long product descriptions and all item rows without dropping page headers', () => {
  const longName = `${'Long diagnostic description '.repeat(38)}last word`;
  const lines = Array.from({ length: 100 }, (_, index) => ({
    productName: `${index + 1}: ${longName}`,
    hsnCode: `HSN-${index + 1}`,
    quantity: 1,
    unitPrice: 10,
    gst: 5,
    subtotal: 1000,
    gstAmount: 50,
    total: 1050,
  }));
  const pages = renderPOInvoicePages(makeModel(lines), 'compact');
  assert.ok(pages.length > 2);
  for (const [index, page] of pages.entries()) {
    assert.match(page, /S\.No/);
    assert.match(page, /Product/);
    assert.ok(page.includes(`Page ${index + 1} of ${pages.length}`));
    assert.ok(page.includes('PO-20261001-00001'));
  }
  assert.ok(pages.some((page) => page.includes('last word')));
  assert.ok(pages.at(-1).includes('Total Amount'));
  assert.ok(pages.slice(0, -1).every((page) => page.includes('Continued on the next page')));
});

test('keeps the final signature box within A4 bounds at row-count and 100-line boundaries', () => {
  const assertFooterBounds = (template, count) => {
    const lines = Array.from({ length: count }, (_, index) => ({
      productName: `Boundary item ${index + 1}`,
      hsnCode: '3822',
      quantity: 1,
      unitPrice: 10,
      gst: 5,
      subtotal: 1000,
      gstAmount: 50,
      total: 1050,
    }));
    const pages = renderPOInvoicePages(makeModel(lines), template);
    const finalPage = pages.at(-1);
    const signature = finalPage.match(/<text[^>]*y="([\d.]+)"[^>]*>Authorised Signatory<\/text>/);
    const signatureBox = finalPage.match(/<rect x="[^"]+" y="([\d.]+)" width="[^"]+" height="78"/);
    assert.ok(signature, `${template} ${count}: signature text is present`);
    assert.ok(signatureBox, `${template} ${count}: signature box is present`);
    const signatureY = Number(signature[1]);
    const boxBottom = Number(signatureBox[1]) + 78;
    assert.ok(signatureY < 1123, `${template} ${count}: signature text stays on the A4 page`);
    assert.ok(boxBottom <= 1123, `${template} ${count}: signature box stays on the A4 page`);

    const rowRects = [...finalPage.matchAll(
      /<rect x="(?:50|44|38)" y="([\d.]+)" width="(?:694|706|718)" height="([\d.]+)" fill="none"/g,
    )];
    if (rowRects.length) {
      const finalRowsBottom = Math.max(...rowRects.map((row) => Number(row[1]) + Number(row[2])));
      assert.ok(signatureBox && Number(signatureBox[1]) >= finalRowsBottom + 138,
        `${template} ${count}: final item rows leave the reserved footer area clear`);
    }
    for (let index = 1; index <= count; index += 1) {
      assert.ok(pages.some((page) => page.includes(`Boundary item ${index}`)),
        `${template} ${count}: item ${index} is present on a page`);
    }
  };

  for (const template of ['classic', 'modern', 'compact']) {
    for (const count of [29, 27, 36, 100]) assertFooterBounds(template, count);
  }
});

test('rejects unsupported templates and invalid line collections clearly', () => {
  assert.throws(() => renderPOInvoicePages(makeModel(), 'unrecognized'), /Unsupported/);
  assert.throws(() => renderPOInvoicePages({ ...makeModel(), lines: null }, 'classic'), /lines must be an array/);
});
