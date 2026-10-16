import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingIdentity, probeCompatibility } from './compatibility.js';

const identity = { format: 1, contract: 'synthetic', schema: 'synthetic_schema', source: 'a'.repeat(64) };
const json = (body, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
function responses(runtime, candidate = { format: 1, identity }) {
  return async url => url.includes('__development-release') ? json(candidate) : json(runtime);
}
test('matching loaded runtime and same-origin candidate pass; probes omit credentials', async () => {
  const fetcher = responses({ format: 1, identity, ready: true });
  assert.deepEqual(await probeCompatibility(async (url, options) => {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    return fetcher(url);
  }, identity), identity);
});
test('new backend source requires a matching runtime, not a browser reload', async () => {
  const newer = { ...identity, source: 'b'.repeat(64) };
  assert.deepEqual(await probeCompatibility(responses({ format: 1, identity: newer, ready: true },
    { format: 1, identity: newer }), identity), newer);
});
for (const [name, value] of [
  ['stale process', { ...identity, source: 'b'.repeat(64) }],
  ['old contract', { ...identity, contract: 'old' }],
  ['wrong revision', { ...identity, schema: 'old' }],
  ['unknown contract', null],
  ['extra fields', { ...identity, unknown: true }],
]) test(`rejects ${name}`, async () => {
  await assert.rejects(probeCompatibility(responses({ format: 1, identity: value, ready: true }), identity));
});
test('unknown response shapes and nonboolean readiness never authorize', async () => {
  for (const runtime of [null, {}, { format: 2, identity, ready: true },
    { format: 1, identity, ready: 'true' }, { format: 1, identity, ready: false }]) {
    await assert.rejects(probeCompatibility(responses(runtime), identity));
  }
});
test('changed frontend expectations fail closed', async () => {
  await assert.rejects(probeCompatibility(responses({ format: 1, identity, ready: true }), { ...identity, contract: 'other' }));
});
test('HTML fallback, disconnected API and abort timeout fail closed', async () => {
  await assert.rejects(probeCompatibility(async () => json({}, 200, 'text/html'), identity));
  await assert.rejects(probeCompatibility(async () => { throw Error('synthetic unavailable'); }, identity));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(probeCompatibility(async (_, options) => {
    options.signal.throwIfAborted();
  }, identity, '/', controller.signal));
});
test('identity comparison rejects unknown and malformed hashes', () => {
  assert.equal(Boolean(matchingIdentity({}, identity)), false);
  assert.equal(Boolean(matchingIdentity({ ...identity, source: null }, identity)), false);
});
