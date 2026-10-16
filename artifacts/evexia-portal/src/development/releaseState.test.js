import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentRequestUrl } from './releaseState.js';
import { readFile } from 'node:fs/promises';
import { failureGuidance, knownFailure } from './failureGuidance.js';

const origin = 'https://synthetic.replit.dev';
const endpoint = `${origin}/api/v1/portal/resolve?hostname=synthetic.replit.dev`;

test('portal URL objects retain the API origin/path needed for contract headers and blocking', () => {
  for (const input of [endpoint, new URL(endpoint), new Request(endpoint)]) {
    const url = developmentRequestUrl(input, `${origin}/admin/login`);
    assert.equal(url.href, endpoint);
    assert.equal(url.origin, origin);
    assert.ok(url.pathname.startsWith('/api/'));
  }
});

test('relative API paths work and external URLs remain outside same-origin API scope', () => {
  assert.equal(developmentRequestUrl('/api/v1/auth/me', origin).origin, origin);
  for (const input of [
    'https://external.invalid/api/v1/auth/me',
    new URL('https://external.invalid/api/v1/auth/me'),
    new Request('https://external.invalid/api/v1/auth/me'),
  ]) {
    assert.notEqual(developmentRequestUrl(input, origin).origin, origin);
  }
});

test('unknown exceptions never become displayed diagnostics', () => {
  assert.equal(knownFailure('private exception text'), false);
  assert.deepEqual(failureGuidance('private exception text'), failureGuidance('unavailable'));
});

test('retry publishes checking, blocks HTML and stale responses, then recovers without application replay', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const identity = { format: 1, contract: 'synthetic', schema: 'synthetic_schema', source: 'a'.repeat(64) };
  const requests = [];
  let mode = 'html';
  let held;
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async url => {
    requests.push(url);
    if (url.includes('__development-release')) return json({ format: 1, identity });
    if (mode === 'html') return new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } });
    if (mode === 'hold') await new Promise(resolve => { held = resolve; });
    return json({ format: 1, identity, ready: true });
  };
  globalThis.window = { addEventListener() {} };
  try {
    // Model Vite's compile-time defines, without changing the production module
    // or starting a server. Each import gets an isolated real store.
    let source = await readFile(new URL('./releaseState.js', import.meta.url), 'utf8');
    for (const name of ['compatibility', 'failureGuidance']) {
      source = source.replace(`'./${name}.js'`, JSON.stringify(new URL(`./${name}.js`, import.meta.url).href));
    }
    source = source.replaceAll('import.meta.hot', 'undefined').replaceAll('import.meta.env', JSON.stringify({
      EVEXIA_DEVELOPMENT_GATE: true, EVEXIA_DEVELOPMENT_CONTRACT: identity, BASE_URL: '/',
    }));
    const release = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const states = [];
    const unsubscribe = release.releaseSubscribe(() => states.push(release.releaseSnapshot().status));
    await release.retryRelease();
    assert.deepEqual(release.releaseSnapshot(), { status: 'blocked', reason: 'api_not_json' });
    mode = 'hold';
    const late = release.retryRelease();
    while (!held) await new Promise(resolve => setImmediate(resolve));
    assert.equal(release.releaseSnapshot().status, 'checking');
    release.invalidateRelease();
    held();
    await late;
    assert.equal(release.releaseSnapshot().status, 'blocked');
    mode = 'ready';
    await release.retryRelease();
    assert.equal(release.releaseSnapshot().status, 'ready');
    assert.deepEqual(states, ['checking', 'blocked', 'checking', 'blocked', 'checking', 'ready']);
    assert.ok(requests.every(url => url === '/__development-release' || url === '/api/v1/development/compatibility'));
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
