import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverCredentials, resolvePortalHostname } from './portalResolver.js';

const host = 'workspace.region.replit.dev';
const preview = { development: true, previewHostname: host };
test('only exact development HTTPS preview origin sends same-origin cookies', () => {
  assert.equal(resolverCredentials(`https://${host}`, preview), 'same-origin');
  for (const origin of [
    `http://${host}`, `https://${host}:5173`, `https://other.${host}`,
    'https://other.replit.dev', 'https://newuat.allergyevexia.in',
    'http://localhost:80', 'https://user:pass@' + host, 'invalid',
  ]) assert.equal(resolverCredentials(origin, preview), 'omit');
  assert.equal(resolverCredentials(`https://${host}`, { ...preview, development: false }), 'omit');
  assert.equal(resolverCredentials(`https://${host}`), 'omit');
  assert.equal(resolverCredentials('https://newuat.allergyevexia.in', {
    development: true, previewHostname: 'newuat.allergyevexia.in',
  }), 'omit');
});

test('request remains same-origin, no-store, redirect-rejecting and bearer-free', async () => {
  const signal = new AbortController().signal;
  for (const development of [true, false]) {
    for (const role of [null, 'admin', 'mr', 'doctor']) {
      assert.equal(await resolvePortalHostname({
        ...preview, development, origin: `https://${host}`, hostname: host, signal,
        fetchRequest: async (url, options) => {
          assert.equal(url.origin, `https://${host}`);
          assert.equal(url.searchParams.get('hostname'), host);
          assert.equal(options.credentials, development ? 'same-origin' : 'omit');
          assert.equal(options.mode, 'same-origin');
          assert.equal(options.redirect, 'error');
          assert.equal(options.cache, 'no-store');
          assert.equal(options.signal, signal);
          assert.equal(options.headers, undefined);
          return Response.json({ role });
        },
      }), role);
    }
  }
});

test('redirects, outages and malformed/invalid responses fail closed', async () => {
  const responses = [
    Response.json({ role: null }, { status: 503 }),
    Response.json({ role: null }, { status: 307 }),
    new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    ...[{}, null, [], { role: 'super_admin' }, { role: false }].map((body) => Response.json(body)),
    { status: 200, redirected: true, headers: new Headers({ 'content-type': 'application/json' }) },
  ];
  for (const response of responses) await assert.rejects(resolvePortalHostname({
    ...preview, origin: `https://${host}`, hostname: host, fetchRequest: async () => response,
  }));
  for (const name of ['AbortError', 'TimeoutError', 'TypeError']) await assert.rejects(resolvePortalHostname({
    ...preview, origin: `https://${host}`, hostname: host,
    fetchRequest: async () => { throw new DOMException('Unavailable', name); },
  }));
});
