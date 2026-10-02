import assert from 'node:assert/strict';
import { test } from 'node:test';

const user = { id: 'synthetic-id', email: 'synthetic@example.test', username: null, system_role: 'super_admin', permissions: ['admin.access'], password_hash: 'must-not-leak' };
let index = 0;
async function setup(handler) {
  globalThis.BroadcastChannel = undefined;
  let lock = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (_name, work) => {
      const next = lock.then(work);
      lock = next.catch(() => {});
      return next;
    },
  } } });
  globalThis.fetch = handler;
  return import(`./adminSession.js?test=${index++}`);
}
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const payload = { access_token: 'synthetic-memory-token', expires_in: 900, user };

test('login sends bounded cookie request, verifies permission via me and allowlists identity', async () => {
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', true);
  assert.equal(api.getSession().status, 'authenticated');
  assert.equal(api.getSession().user.password_hash, undefined);
  assert.deepEqual(JSON.parse(calls[0][1].body), { identifier: user.email, password: 'synthetic-password', remember_me: true });
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer synthetic-memory-token');
  await api.logoutAdmin();
});

test('rejects MR and super_admin without explicit permission, revokes denied login', async () => {
  for (const identity of [{ ...user, system_role: 'mr' }, { ...user, permissions: [] }]) {
    const paths = [];
    const api = await setup(async (url) => {
      paths.push(url);
      return url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? identity : payload);
    });
    await assert.rejects(api.loginAdmin(user.email, 'synthetic-password', false), /Admin access/);
    assert.equal(api.getSession().status, 'anonymous');
    assert.ok(paths.includes('/api/v1/auth/logout'));
  }
});

test('generic 401, 429 and network failure states are safe', async () => {
  for (const status of [401, 429]) {
    const api = await setup(async () => reply({ detail: 'unsafe provider detail' }, status));
    await assert.rejects(api.loginAdmin('unknown@example.test', 'synthetic-password', false));
    assert.equal(api.getSession().status, 'anonymous');
    assert.ok(!api.getSession().message.includes('unsafe'));
    if (status === 429) assert.match(api.getSession().message, /Too many attempts/);
  }
  const api = await setup(async () => { throw new Error('private network data'); });
  await assert.rejects(api.loginAdmin(user.email, 'synthetic-password', false), /Unable to reach/);
});

test('restoration serializes concurrent requests and never loops on failed refresh', async () => {
  let refreshes = 0;
  const api = await setup(async (url) => {
    if (url.endsWith('/refresh')) refreshes++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return reply(url.endsWith('/me') ? user : payload);
  });
  await Promise.all([api.verifySession(), api.verifySession(), api.verifySession()]);
  assert.equal(refreshes, 1);
  assert.equal(api.getSession().status, 'authenticated');
  await api.logoutAdmin();
  const failed = await setup(async () => reply({}, 401));
  await failed.verifySession();
  assert.equal(failed.getSession().status, 'anonymous');
});

test('logout defeats late refresh response; failed revocation is not claimed successful', async () => {
  let release;
  let started;
  const wait = new Promise((resolve) => { started = resolve; });
  const api = await setup(async (url) => {
    if (url.endsWith('/refresh')) {
      started();
      await new Promise((resolve) => { release = resolve; });
      return reply(payload);
    }
    if (url.endsWith('/logout')) throw new Error('outage');
    return reply(user);
  });
  const restoring = api.verifySession();
  await wait;
  const leaving = api.logoutAdmin();
  release();
  await restoring;
  assert.equal(await leaving, false);
  assert.equal(api.getSession().status, 'anonymous');
  assert.match(api.getSession().message, /could not be confirmed/);
  await api.verifySession();
  assert.equal(api.getSession().status, 'anonymous');
});

test('safe return paths reject external, login, encoded, traversal and query destinations', async () => {
  const api = await setup(async () => reply({}, 401));
  assert.equal(api.safeAdminReturn('/admin/masters/zones'), '/admin/masters/zones');
  for (const path of ['https://evil.test', '//evil.test', '/mr', '/admin/login', '/admin/../doctor', '/admin/%2f', '/admin\\evil', '/admin?token=bad']) {
    assert.equal(api.safeAdminReturn(path), '/admin');
  }
});

test('same-route renewal preserves safe identity on transient error but never keeps it on denial', async () => {
  let outcome = 'success';
  const api = await setup(async (url) => {
    if (url.endsWith('/refresh') && outcome === 'outage') throw new Error('outage');
    if (url.endsWith('/refresh') && outcome === 'denied') return reply({}, 401);
    return url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const verified = api.getSession().user;
  outcome = 'outage';
  const retrying = api.verifySession(true);
  assert.equal(api.getSession().status, 'renewing');
  assert.equal(api.getSession().user, verified);
  await retrying;
  assert.equal(api.getSession().status, 'renewal-error');
  assert.equal(api.getSession().user, verified);
  outcome = 'success';
  await api.verifySession();
  assert.equal(api.getSession().status, 'authenticated');
  outcome = 'denied';
  await api.verifySession(true);
  assert.equal(api.getSession().status, 'anonymous');
  assert.equal(api.getSession().user, null);
});

test('network restoration errors require explicit retry and missing browser lock fails closed', async () => {
  const api = await setup(async () => { throw new Error('outage'); });
  await api.verifySession();
  assert.equal(api.getSession().status, 'error');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(api.loginAdmin(user.email, 'synthetic-password', false), /Web Locks/);
});

test('logout clears local authorization immediately and sends only an empty same-origin cookie request', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/logout')) { await gate; return reply(null, 204); }
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const closing = api.logoutAdmin();
  assert.equal(api.getSession().status, 'anonymous');
  assert.equal(api.getSession().user, null);
  await new Promise((resolve) => setImmediate(resolve));
  const [url, options] = calls.at(-1);
  assert.equal(url, '/api/v1/auth/logout');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.deepEqual(JSON.parse(options.body), {});
  assert.equal(options.headers.Authorization, undefined);
  const beforeRestore = calls.length;
  await api.verifySession(true);
  assert.equal(calls.length, beforeRestore);
  release();
  assert.equal(await closing, true);
  assert.equal(api.getSession().message, '');
});

test('repeated and simultaneous logout requests stay anonymous and succeed without session identifiers', async () => {
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    return reply(null, 204);
  });
  assert.deepEqual(await Promise.all([api.logoutAdmin(), api.logoutAdmin()]), [true, true]);
  assert.equal(await api.logoutAdmin(), true);
  assert.equal(api.getSession().status, 'anonymous');
  assert.equal(api.getSession().user, null);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([url, options]) => url.endsWith('/logout') && options.body === '{}'));
});

test('a completed older logout cannot erase a subsequent explicit login', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const paths = [];
  let held = true;
  const api = await setup(async (url) => {
    paths.push(url);
    if (url.endsWith('/logout')) {
      if (held) await gate;
      return reply(null, 204);
    }
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const closing = api.logoutAdmin();
  const signingIn = api.loginAdmin(user.email, 'synthetic-password', false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(paths.filter((url) => url.endsWith('/login')).length, 1);
  held = false;
  release();
  assert.equal(await closing, true);
  await signingIn;
  assert.equal(api.getSession().status, 'authenticated');
  assert.equal(api.getSession().user.id, user.id);
  await api.logoutAdmin();
});