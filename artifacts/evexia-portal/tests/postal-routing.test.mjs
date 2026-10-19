import test from 'node:test';
import assert from 'node:assert/strict';
import { postalFailure } from '../src/services/postalFeedback.js';

test('all four adapters preserve exact postal routes, action, authentication and cancellation', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { locks: { request: async (_name, work) => work() } } });
  const session = await import('../src/auth/adminSession.js');
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  let status = 200;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/')) {
      calls.push({ url, options });
      return new Response(JSON.stringify(status === 200 ? { choices: [], message: 'No match' }
        : { error: { code: status === 503 ? 'mr_pin_unavailable' : 'mr_pin_rate', message: 'Not for display' } }), { status });
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null
      : JSON.stringify(url.endsWith('/me') ? user : { access_token: 'synthetic-token', expires_in: 900 }),
    { status: url.endsWith('/logout') ? 204 : 200 });
  };
  await session.loginAdmin(user.email, 'synthetic-password', false);
  try {
    const adapters = [
      ['storage-locations', (await import('../src/services/serverLocations.js')).lookupLocationPIN],
      ['mrs', (await import('../src/services/serverMRs.js')).lookupPincode],
      ['doctors', (await import('../src/services/serverDoctors.js')).lookupDoctorPIN],
      ['patients', (await import('../src/services/serverPatients.js')).lookupPatientPIN],
    ];
    for (const [resource, lookup] of adapters) {
      for (const action of ['add', 'edit']) {
        const controller = new AbortController();
        await lookup('411001', controller.signal, action);
        const call = calls.at(-1);
        assert.equal(call.url, `/api/v1/admin/${resource}/postal/411001?action=${action}`);
        assert.equal(call.options.method, 'GET');
        assert.equal(call.options.headers.Authorization, 'Bearer synthetic-token');
        controller.abort();
        assert.equal(call.options.signal.aborted, true);
      }
      const before = calls.length;
      for (const pin of ['011001', '41100', '411001/extra', '../411001', '411001?x=1']) {
        await assert.rejects(lookup(pin), /Unsupported/);
      }
      await assert.rejects(lookup('411001', undefined, 'delete'), /Unsupported/);
      assert.equal(calls.length, before);
    }
    for (const path of ['/postal/411001/extra', '/references', '/postal/011001', '/postal/411001?x=1']) {
      await assert.rejects(session.locationRequest(path), /Unsupported/);
    }
    await assert.rejects(session.courierRequest('/postal/411001'), /Unsupported/);
    await assert.rejects(session.locationRequest('/postal/411001', { body: {} }), /Unsupported/);
    for (const code of [429, 503]) {
      status = code;
      await assert.rejects(adapters[0][1]('411001'), (error) =>
        error.status === code && postalFailure(error).retryable && !postalFailure(error).message.includes('Not for display'));
    }
    status = 200;
    await session.logoutAdmin();
    Object.assign(user, { identity_kind: 'staff', system_role: null, permissions: ['workspace.access', 'location.add'] });
    await session.loginAdmin(user.email, 'synthetic-password', false);
    await adapters[0][1]('411001', undefined, 'add');
    const beforeDenied = calls.length;
    await assert.rejects(adapters[0][1]('411001', undefined, 'edit'), (error) => error.status === 403);
    for (const [, lookup] of adapters.slice(1)) await assert.rejects(lookup('411001'), (error) => error.status === 403);
    assert.equal(calls.length, beforeDenied);
    await session.logoutAdmin();
    user.permissions = ['workspace.access', 'location.edit'];
    await session.loginAdmin(user.email, 'synthetic-password', false);
    await adapters[0][1]('411001', undefined, 'edit');
    await assert.rejects(adapters[0][1]('411001', undefined, 'add'), (error) => error.status === 403);
  } finally { await session.logoutAdmin(); }
});

test('failure feedback distinguishes authorization, quota, provider and unknown errors without echoing internals', () => {
  assert.match(postalFailure({ status: 401 }).message, /verified session/);
  assert.match(postalFailure({ status: 403 }).message, /permission/);
  assert.equal(postalFailure({ status: 403 }).retryable, false);
  assert.match(postalFailure({ status: 429 }).message, /limit reached/);
  assert.match(postalFailure({ status: 429, code: 'mr_pin_busy' }).message, /busy/);
  assert.match(postalFailure({ status: 503, code: 'mr_pin_unavailable' }).message, /provider is unavailable/);
  assert.match(postalFailure(new Error('private detail')).message, /connection/);
  assert.doesNotMatch(postalFailure(new Error('private detail')).message, /private detail/);
});
