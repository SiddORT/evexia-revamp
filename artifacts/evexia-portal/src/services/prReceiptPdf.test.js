import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptPdf, encodeReceiptText, measureReceiptTextPages } from './prReceiptPdf.js';
import { buildInvoicePdf } from './poInvoicePdf.js';

const jpeg = { bytes: new Uint8Array([255, 216, 255, 217]), width: 794, height: 1123 };
function run(text, x = 44, y = 100) {
  return {
    text, x, y, size: 10, width: text.length * 5,
    glyphs: Array.from(text, (_, i) => ({ x: x + i * 5, width: 5 })),
  };
}

test('encodes exact Latin text and receipt punctuation and explicitly rejects unsupported glyphs', () => {
  assert.deepEqual(encodeReceiptText('Aé—·€'), [65, 233, 151, 183, 128]);
  for (const text of ['हिंदी', '中文', '😀', 'e\u0301', '\u0000']) {
    assert.throws(() => encodeReceiptText(text), /does not support.*U\+.*Image-only PDF/);
  }
});

test('writes searchable multipage A4 PDF with Unicode text, aligned glyphs, valid stream lengths and offsets', () => {
  const pdf = buildReceiptPdf([jpeg, jpeg], [
    [run('PR-001 — 4.125 & <Product> (é)'), run('LOCAL DEMO · DELETED', 100, 150)],
    [run('Balance Qty —'), run('Authorised Signatory')],
  ]);
  const content = Buffer.from(pdf).toString('latin1');
  assert.match(content, /\/Count 2/);
  assert.equal((content.match(/\/MediaBox \[0 0 595.28 841.89\]/g) || []).length, 2);
  assert.match(content, /\/ToUnicode 4 0 R/);
  assert.match(content, /<97> <2014>/);
  assert.match(content, /<e9> <00e9>/);
  assert.match(content, /3 Tr/);
  assert.match(content, /<34> Tj/); // Saved quantity "4", never recalculated.
  const startXref = Number(content.match(/startxref\n(\d+)/)[1]);
  assert.equal(content.slice(startXref, startXref + 4), 'xref');
  const lines = content.slice(startXref).split('\n');
  const count = Number(lines[1].split(' ')[1]);
  for (let id = 1; id < count; id++) {
    const offset = Number(lines[id + 2].slice(0, 10));
    assert.equal(content.slice(offset).startsWith(`${id} 0 obj`), true);
  }
  for (const match of content.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = match.index + match[0].length;
    assert.equal(content.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream');
  }
  assert.doesNotMatch(Buffer.from(buildInvoicePdf([jpeg])).toString('latin1'), /ToUnicode|FReceipt|3 Tr/);
});

test('does not produce partial PDFs for missing text, unsupported characters or invalid geometry', () => {
  assert.throws(() => buildReceiptPdf([jpeg], []), /every PDF page/);
  assert.throws(() => buildReceiptPdf([jpeg], [[]]), /every PDF page/);
  assert.throws(() => buildReceiptPdf([jpeg], [[run('न')]]), /does not support/);
  assert.throws(() => buildReceiptPdf([jpeg], [[{ ...run('text'), size: NaN }]]), /geometry/);
  assert.throws(() => buildReceiptPdf([jpeg], [[{ ...run('text'), glyphs: [] }]]), /glyph positions/);
  const invalid = run('text');
  invalid.glyphs[0].width = -1;
  assert.throws(() => buildReceiptPdf([jpeg], [[invalid]]), /glyph geometry/);
  assert.throws(() => buildReceiptPdf([{ ...jpeg, bytes: new Uint8Array([0]) }], [[run('text')]]), /complete JPEG/);
  assert.throws(() => measureReceiptTextPages(['<svg/>']), /browser with SVG text measurement/);
});