import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentRequestUrl } from './releaseState.js';

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
