import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { frontendIdentity, frontendRuntimePlugin } from './frontend-runtime.mjs';

test('development identity is captured once, rather than recalculated per HTTP request', () => {
  const plugin = frontendRuntimePlugin('/');
  plugin.configResolved();
  let middleware;
  plugin.configureServer({ middlewares: { use(fn) { middleware = fn; } } });
  const expected = { ...frontendIdentity(), mode: 'development', assets: {} };
  let body;
  middleware({ url: '/release-runtime.json' }, { setHeader() {}, end(b) { body = b; } }, () => assert.fail());
  assert.deepEqual(JSON.parse(body), expected);
  let next = false;
  middleware({ url: '/unrelated' }, {}, () => { next = true; });
  assert.equal(next, true);
});

test('build manifest hashes compiled bytes, not commit labels', () => {
  const plugin = frontendRuntimePlugin('/');
  plugin.configResolved();
  let emitted;
  plugin.generateBundle.handler.call({ emitFile(item) { emitted = item; } }, {}, {
    'assets/app.js': { type: 'chunk', code: 'real compiled javascript' },
    'index.html': { type: 'asset', source: '<html />' },
  });
  const metadata = JSON.parse(emitted.source);
  assert.equal(metadata.mode, 'build');
  assert.equal(metadata.assets['assets/app.js'], crypto.createHash('sha256').update('real compiled javascript').digest('hex'));
  assert.equal(emitted.fileName, 'release-runtime.json');
  assert.ok(metadata.assets['index.html']);
});
