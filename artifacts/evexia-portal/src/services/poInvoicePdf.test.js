import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoicePdf } from './poInvoicePdf.js';

const tinyJpeg = new Uint8Array(Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIRAxEAPwD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2Q==',
  'base64',
));

test('builds a valid multipage PDF with exact JPEG stream lengths and byte offsets', () => {
  const pages = [
    { bytes: tinyJpeg, width: 2, height: 2 },
    { bytes: tinyJpeg, width: 1588, height: 2246 },
  ];
  const pdf = buildInvoicePdf(pages);
  const content = Buffer.from(pdf).toString('latin1');
  assert.ok(content.startsWith('%PDF-1.4'));
  assert.match(content, /\/Type \/Pages[^>]*\/Count 2/);
  assert.equal((content.match(/\/Type \/Page \/Parent/g) || []).length, 2);
  assert.equal((content.match(/\/Subtype \/Image/g) || []).length, 2);

  const imageStreams = [...content.matchAll(/\/Subtype \/Image[\s\S]*?\/Length (\d+) >>\nstream\n/g)];
  assert.equal(imageStreams.length, 2);
  for (const match of imageStreams) {
    assert.equal(Number(match[1]), tinyJpeg.byteLength);
    const streamStart = match.index + match[0].length;
    assert.deepEqual(
      new Uint8Array(pdf.slice(streamStart, streamStart + tinyJpeg.byteLength)),
      tinyJpeg,
    );
  }

  const startXref = Number(content.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(content.slice(startXref, startXref + 4), 'xref');
  const xrefLines = content.slice(startXref).split('\n');
  const size = Number(xrefLines[1].split(' ')[1]);
  for (let object = 1; object < size; object += 1) {
    const offset = Number(xrefLines[2 + object].slice(0, 10));
    assert.equal(content.slice(offset).startsWith(`${object} 0 obj`), true);
  }
  assert.ok(content.includes('/MediaBox [0 0 595.28 841.89]'));
});

test('rejects incomplete JPEG data and empty page arrays', () => {
  assert.throws(() => buildInvoicePdf([]), /At least one/);
  assert.throws(() => buildInvoicePdf([{ bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 }]), /complete JPEG/);
  assert.throws(() => buildInvoicePdf([{ bytes: tinyJpeg, width: 0, height: 1 }]), /dimensions/);
});
