import test from 'node:test';
test('escapes large unterminated markup and rejects control characters before import replaces a draft', async () => {
  const preview = buildEmailPreview('<'.repeat(100000));
  assert.ok(preview.includes('&lt;'.repeat(100000)));
  const bytes = new TextEncoder().encode('<p>bad\u0000file</p>');
  await assert.rejects(readHtmlFile({
    name: 'invalid.html', size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  }), /unsupported control characters/);
});
import assert from 'node:assert/strict';
import {
  SUPPORTED_TOKENS,
  SAMPLE_VALUES,
  inspectTokens,
  substituteTokens,
  buildEmailPreview,
  readHtmlFile,
} from './messageTemplatePreview.js';

function file(name, content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test('exports supported literal tokens and fictional sample values', () => {
  assert.deepEqual(SUPPORTED_TOKENS, ['recipient_name', 'order_number', 'amount', 'company_name']);
  assert.deepEqual(Object.keys(SAMPLE_VALUES), SUPPORTED_TOKENS);
  assert.ok(Object.values(SAMPLE_VALUES).every((value) => typeof value === 'string' && value.length > 0));
});

test('inspects unique valid names and reports unsupported and malformed brace expressions', () => {
  assert.deepEqual(inspectTokens(
    '{{recipient_name}} / {{recipient_name}} {{unknown_2}} {{bad.name}} {single} {{{triple}}} {{unfinished',
  ), {
    tokens: ['recipient_name', 'unknown_2'],
    unknown: ['unknown_2'],
    malformed: ['{{bad.name}}', '{single}', '{{{triple}}}', '{{unfinished'],
  });
  assert.deepEqual(inspectTokens('left }} and { and {{{'), {
    tokens: [],
    unknown: [],
    malformed: ['}}', '{', '{{{'],
  });
  assert.deepEqual(inspectTokens(null), { tokens: [], unknown: [], malformed: [] });
});

test('substitution is limited to supported own string properties and is not recursive', () => {
  const values = Object.create({ recipient_name: 'inherited' });
  values.order_number = '{{recipient_name}}';
  values.amount = '<b>$9 & "paid"</b>';
  values.company_name = 123;
  const text = '{{recipient_name}} {{order_number}} {{amount}} {{company_name}} {{unknown}}';

  assert.equal(
    substituteTokens(text, values),
    '{{recipient_name}} {{recipient_name}} <b>$9 & "paid"</b> {{company_name}} {{unknown}}',
  );
  assert.equal(
    substituteTokens(text, values, true),
    '{{recipient_name}} {{recipient_name}} &lt;b&gt;$9 &amp; &quot;paid&quot;&lt;/b&gt; {{company_name}} {{unknown}}',
  );
  assert.equal(substituteTokens('{{amount}}', { amount: `&<>"'` }, true),
    '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(substituteTokens('{{amount}}', { amount: '<script>alert(1)</script>' }, true),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('email preview preserves safe email formatting and applies restrictive sandbox CSP', () => {
  const preview = buildEmailPreview(
    '<p style="color:#123456; font-size:16px; position:fixed">Hello <strong>{{recipient_name}}</strong></p>' +
      '<table border="1"><tr><td align="center">Order {{order_number}}</td></tr></table>',
    { recipient_name: 'Mira & Co.', order_number: 'EVX-01' },
  );

  assert.match(preview, /^<!doctype html><html><head>/i);
  assert.match(preview, /default-src 'none'/);
  assert.match(preview, /script-src 'none'/);
  assert.match(preview, /style-src 'unsafe-inline'/);
  assert.match(preview, /img-src 'none'/);
  assert.match(preview, /font-src 'none'/);
  assert.match(preview, /connect-src 'none'/);
  assert.match(preview, /form-action 'none'/);
  assert.match(preview, /base-uri 'none'/);
  assert.match(preview, /frame-src 'none'/);
  assert.match(preview, /sandbox/);
  assert.match(preview, /<strong>Mira &amp; Co\.<\/strong>/);
  assert.match(preview, /<table border="1"><tr><td align="center">Order EVX-01<\/td><\/tr><\/table>/);
  assert.match(preview, /style="color:#123456;font-size:16px"/);
  assert.doesNotMatch(preview, /position:fixed/);
});

test('email preview removes active markup, navigation, outbound resources, and unsafe CSS without DOM parsing', () => {
  const hostile = [
    '<!doctype html><html><head><base href="https://attacker.invalid/">' +
      '<link rel="stylesheet" href="https://attacker.invalid/x.css">' +
      '<style>@import url(https://attacker.invalid/x.css); body{background:url(https://attacker.invalid/bg)}</style>' +
      '<meta http-equiv="refresh" content="0;url=https://attacker.invalid"></head><body>',
    '<p onclick="alert(1)" onmouseover="fetch(1)" style="color:red;background-image:url(https://attacker.invalid/x);' +
      'font-family:url(https://attacker.invalid/font);border:1px solid blue">Safe &amp; sound</p>',
    '<a href="javascript:alert(1)" target="_blank">No navigation</a>' +
      '<img src="https://attacker.invalid/pixel" srcset="https://attacker.invalid/2x">' +
      '<form action="https://attacker.invalid"><input name="x"><button>Submit</button></form>',
    '<script src="https://attacker.invalid/x.js">alert(document.cookie)</script>' +
      '<svg><image href="https://attacker.invalid/svg"/></svg>' +
      '<math><mi>x</mi></math><iframe src="https://attacker.invalid"></iframe>',
    '<table><tr><td style="background-color:rgb(1, 2, 3)">Table cell</td></tr></table></body></html>',
  ].join('');
  const preview = buildEmailPreview(hostile);

  assert.match(preview, /<p style="color:red;border:1px solid blue">Safe &amp; sound<\/p>/);
  assert.match(preview, /<table><tr><td style="background-color:rgb\(1, 2, 3\)">Table cell<\/td><\/tr><\/table>/);
  assert.doesNotMatch(preview, /attacker\.invalid|onclick|onmouseover|javascript:|<script|<svg|<math|<iframe|<form|<input|<button|<a\b|<img\b|<style>@import|<base\b|<link\b|<meta http-equiv="refresh"/i);
  assert.doesNotMatch(preview, /background-image|font-family:url|alert\(document\.cookie\)/i);
});

test('preview sanitizes again after substitution so hostile sample values stay inert', () => {
  const preview = buildEmailPreview('<p>{{recipient_name}}</p>', {
    recipient_name: '<img src="https://attacker.invalid/pixel" onerror="alert(1)">',
  });

  assert.match(preview, /&lt;img src=&quot;https:\/\/attacker\.invalid\/pixel&quot; onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(preview, /<img\b|<[^>]+\sonerror=/i);
});

test('reads bounded UTF-8 html/htm files and rejects bad types, encodings, and empty content', async () => {
  assert.equal(await readHtmlFile(file('notice.HTML', '<p>{{recipient_name}}</p>')), '<p>{{recipient_name}}</p>');
  assert.equal(await readHtmlFile(file('notice.htm', '<table></table>')), '<table></table>');
  await assert.rejects(readHtmlFile(null), /valid \.html or \.htm/);
  await assert.rejects(readHtmlFile(file('notice.txt', '<p>no</p>')), /valid \.html or \.htm/);
  await assert.rejects(readHtmlFile(file('notice.html', ' \n\t')), /empty/);
  await assert.rejects(readHtmlFile(file('notice.html', [0xc3, 0x28])), /valid UTF-8/);
  await assert.rejects(readHtmlFile(file('notice.html', new Uint8Array(100_001))), /100,000 bytes/);
  await assert.rejects(readHtmlFile({
    name: 'notice.html',
    size: 100_001,
    arrayBuffer: async () => new Uint8Array().buffer,
  }), /100,000 bytes/);
  await assert.rejects(readHtmlFile({
    name: 'notice.html',
    size: 3,
    arrayBuffer: async () => { throw new Error('read failure'); },
  }), /could not be read/);
});