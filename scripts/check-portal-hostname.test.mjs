import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPortalHostname } from './check-portal-hostname.mjs';

const response = (body = { role: null }, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });

test('normal ingress probes actual hostname and DB-backed DNS lookup without credentials', async () => {
  const hosts = [];
  const evidence = [];
  await checkPortalHostname('http://localhost:80/', async (url, options) => {
    assert.equal(url.origin, 'http://localhost');
    assert.equal(url.pathname, '/api/v1/portal/resolve');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    hosts.push(url.searchParams.get('hostname'));
    return response();
  }, (line) => evidence.push(line));
  assert.deepEqual(hosts, ['localhost', 'portal-smoke-unmapped.allergyevexia.com']);
  assert.equal(evidence.length, 2);
});

for (const role of [null, 'admin', 'mr', 'doctor']) {
  test(`accepts resolved role ${role} without assuming the host is unmapped`, async () => {
    await checkPortalHostname('https://preview.example.com', async () => response({ role }), () => {});
  });
}
for (const status of [404, 503]) {
  test(`rejects HTTP ${status} rather than treating it as unmapped`, async () => {
    await assert.rejects(checkPortalHostname('http://localhost', async () => response({}, status)), /expected 200/);
  });
}
test('rejects HTML fallback even when status is 200', async () => {
  await assert.rejects(checkPortalHostname('http://localhost', async () => response({}, 200, 'text/html')), /did not return JSON/);
});
for (const body of [{}, { role: 'patient' }, { role: null, extra: true }, [], null]) {
  test(`rejects malformed resolver shape ${JSON.stringify(body)}`, async () => {
    await assert.rejects(checkPortalHostname('http://localhost', async () => response(body)), /invalid response shape/);
  });
}
test('detects DB-backed resolver failure even when localhost succeeds', async () => {
  await assert.rejects(checkPortalHostname('http://localhost', async (url) =>
    url.searchParams.get('hostname') === 'localhost' ? response() : response({}, 503)),
  /HTTP 503/);
});
test('rejects malformed JSON and cacheable responses', async () => {
  await assert.rejects(checkPortalHostname('http://localhost', async () =>
    new Response('{broken', { headers: { 'Content-Type': 'application/json' } })), SyntaxError);
  await assert.rejects(checkPortalHostname('http://localhost', async () =>
    new Response('{"role":null}', { headers: { 'Content-Type': 'application/json' } })), /no-store/);
});
test('network outage fails explicitly', async () => {
  await assert.rejects(checkPortalHostname('http://localhost', async () => { throw new Error('offline'); }), /offline/);
});
