import assert from 'node:assert/strict';
import { test } from 'node:test';

const user = { id: 'synthetic-id', email: 'synthetic@example.test', username: null, system_role: 'super_admin', identity_kind: 'super_admin', permissions: ['admin.access'], password_hash: 'must-not-leak' };
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

test('courier transport sends versions, raw review and filtered downloads without exposing credentials', async () => {
  const requests = [];
  const api = await setup(async (url, options) => {
    if (url.includes('/admin/courier-partners')) {
      requests.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      if (url.includes('/export')) return new Response('Courier Partner Name,Status', {
        headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
      });
      if (url.includes('/status')) return reply({ error: { code: 'courier_stale', message: 'Review current record.' } }, 409);
      if (url.includes('/delete')) throw new Error('private provider detail');
      return reply({ valid: true, digest: 'review' });
    }
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  await api.courierRequest('/import/review', { file: 'synthetic csv', params: { filename: 'couriers.csv' } });
  assert.equal(requests[0].options.body, 'synthetic csv');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/octet-stream');
  const blob = await api.courierRequest('/export', { params: { query: 'City', status: 'inactive', format: 'xlsx' }, download: true });
  assert.ok(blob instanceof Blob);
  assert.match(requests[1].url, /query=City&status=inactive&format=xlsx/);
  await assert.rejects(api.courierRequest('/00000000-0000-0000-0000-000000000001/status',
    { body: { status: 'inactive', expected_version: 2 } }), (error) => error.code === 'courier_stale');
  assert.deepEqual(JSON.parse(requests[2].options.body), { status: 'inactive', expected_version: 2 });
  await assert.rejects(api.courierRequest('/00000000-0000-0000-0000-000000000001/delete',
    { body: { expected_version: 2 } }), (error) => error.ambiguous);
  assert.equal(requests.length, 4); // ambiguous writes are never replayed
  await api.logoutAdmin();
});

test('courier body decoding cannot repopulate data after logout', async () => {
  let release, decoding;
  const started = new Promise((resolve) => { decoding = resolve; });
  const api = await setup(async (url) => {
    if (url.includes('/admin/courier-partners')) return {
      ok: true, status: 200, json: async () => { decoding(); return new Promise((resolve) => { release = resolve; }); },
    };
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const read = api.courierRequest();
  await started;
  await api.logoutAdmin();
  release({ items: [{ name: 'Protected data' }] });
  await assert.rejects(read, /session changed/i);
});

test('zone transport keeps credentials in memory, uses versions/raw files and never replays ambiguous writes', async () => {
  let writes = 0;
  const api = await setup(async (url, options) => {
    if (url.includes('/admin/zones')) {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
      assert.equal(options.cache, 'no-store');
      if (url.includes('/import/review')) {
        assert.equal(options.body, 'synthetic csv');
        assert.equal(options.headers['Content-Type'], 'application/octet-stream');
        return reply({ valid: true });
      }
      writes++;
      assert.deepEqual(JSON.parse(options.body), { expected_version: 3 });
      throw new Error('private provider detail');
    }
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  assert.deepEqual(await api.zoneRequest('/import/review', { file: 'synthetic csv', params: { filename: 'zones.csv' } }), { valid: true });
  await assert.rejects(api.zoneRequest('/00000000-0000-0000-0000-000000000001/delete', { body: { expected_version: 3 } }), (error) => error.ambiguous === true);
  assert.equal(writes, 1);
  await api.logoutAdmin();
});

test('zone decoded responses cannot survive logout and stale errors are actionable', async () => {
  let release;
  const api = await setup(async (url) => {
    if (url.includes('/admin/zones')) return new Promise((resolve) => { release = resolve; });
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const read = api.zoneRequest();
  await api.logoutAdmin();
  release(reply({ items: [{ name: 'private record' }] }));
  await assert.rejects(read, /session changed/i);
  const stale = await setup(async (url) => reply(url.includes('/admin/zones')
    ? { error: { code: 'zone_stale', message: 'Refresh and review before retrying.' } } : url.endsWith('/me') ? user : payload,
    url.includes('/admin/zones') ? 409 : 200));
  await stale.loginAdmin(user.email, 'synthetic-password', false);
  await assert.rejects(stale.zoneRequest('', { body: { name: 'draft' } }), (error) => error.code === 'zone_stale' && /review/.test(error.message));
  await stale.logoutAdmin();
});

test('role transport is narrowly scoped, permission guarded and never replays uncertain mutations', async () => {
  let writes = 0;
  const identity = { ...user, permissions: ['admin.access', 'roles.manage'] };
  const api = await setup(async (url, options) => {
    if (url.includes('/admin/roles')) {
      writes++;
      assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
      assert.equal(options.cache, 'no-store');
      throw Error('private outage');
    }
    return reply(url.endsWith('/me') ? identity : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  await assert.rejects(api.roleRequest('', { name: 'Reviewer' }), (e) => e.ambiguous && /Refresh roles/.test(e.message));
  assert.equal(writes, 1);
  await assert.rejects(api.roleRequest('/permissions', {}), /Unsupported/);
  await assert.rejects(api.roleRequest('?limit=500'), /Unsupported/);
  await api.logoutAdmin();
  const denied = await setup(async (url) => reply(url.endsWith('/me') ? user : payload));
  await denied.loginAdmin(user.email, 'synthetic-password', false);
  await assert.rejects(denied.roleRequest(), /access denied/);
  await denied.logoutAdmin();
});

test('role responses are owner guarded through body decode; safe errors distinguish stale, deleted and ambiguous', async () => {
  const identity = { ...user, permissions: ['admin.access', 'roles.manage'] };
  let outcome = 'role_stale', release, start;
  const started = new Promise((resolve) => { start = resolve; });
  const api = await setup(async (url) => {
    if (url.includes('/admin/roles')) {
      if (outcome === 'late') return { ok: true, status: 200, json: async () => {
        start(); await new Promise((resolve) => { release = resolve; }); return { private: true };
      } };
      if (outcome === 'invalid') return new Response('invalid', { status: 200 });
      return reply({ error: { code: outcome, message: 'unsafe details' } },
        outcome === 'role_deleted' ? 404 : outcome === 'roles_unavailable' ? 503 : 409);
    }
    return reply(url.endsWith('/me') ? identity : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  for (const [code, message] of [['role_stale', /changed/], ['role_deleted', /deleted/], ['role_duplicate', /already exists/], ['roles_unavailable', /unavailable/]]) {
    outcome = code;
    await assert.rejects(api.roleRequest('', { name: 'R' }), (e) => e.code === code && !e.ambiguous && message.test(e.message) && !e.message.includes('unsafe'));
  }
  outcome = 'invalid';
  await assert.rejects(api.roleRequest('', { name: 'R' }), (e) => e.ambiguous === true);
  outcome = 'late';
  const read = api.roleRequest();
  await started;
  await api.logoutAdmin();
  release();
  await assert.rejects(read, /session changed/);
});

test('staff mutations use memory-only bearer and never replay ambiguous create requests', async () => {
  let writes = 0;
  const identity = { ...user, permissions: ['admin.access', 'staff.manage'] };
  const api = await setup(async (url, options) => {
    if (url.includes('/admin/staff')) {
      writes++;
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
      throw Error('private outage detail');
    }
    return reply(url.endsWith('/me') ? identity : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  await assert.rejects(api.staffRequest('', { name: 'synthetic' }), (error) => error.ambiguous === true && /outcome could not be confirmed/.test(error.message));
  assert.equal(writes, 1);
  await api.logoutAdmin();
});

test('staff permission is explicit and delayed responses cannot survive logout', async () => {
  const denied = await setup(async (url) => reply(url.endsWith('/me') ? user : payload));
  await denied.loginAdmin(user.email, 'synthetic-password', false);
  await assert.rejects(denied.staffRequest(), /access denied/i);
  await denied.logoutAdmin();
  let release;
  const identity = { ...user, permissions: ['admin.access', 'staff.manage'] };
  const api = await setup(async (url) => {
    if (url.includes('/admin/staff')) return new Promise((resolve) => { release = resolve; });
    return reply(url.endsWith('/me') ? identity : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const read = api.staffRequest();
  await api.logoutAdmin();
  release(reply({ items: [] }));
  await assert.rejects(read, /session changed/i);
});

for (const replacement of ['none', 'different identity', 'same identity']) {
  test(`staff body decoding rejects the old payload after logout with ${replacement === 'none' ? 'no new sign-in' : `a new sign-in for the ${replacement}`}`, async (t) => {
    const identity = { ...user, permissions: ['admin.access', 'staff.manage'] };
    const nextIdentity = replacement === 'different identity'
      ? { ...identity, id: 'synthetic-replacement-id', email: 'replacement@example.test' }
      : identity;
    let currentIdentity = identity;
    let release, start;
    const started = new Promise((resolve) => { start = resolve; });
    const body = new Promise((resolve) => { release = resolve; });
    const api = await setup(async (url) => {
      if (url.includes('/admin/staff')) return {
        ok: true, status: 200,
        // Fetch has delivered the headers. Only body decoding is held, and
        // this synthetic response intentionally does not react to aborts.
        json: async () => { start(); return body; },
      };
      if (url.endsWith('/logout')) return reply(null, 204);
      return reply(url.endsWith('/me') ? currentIdentity : { ...payload, user: currentIdentity });
    });
    t.after(async () => { release({ items: [] }); await api.logoutAdmin(); });
    await api.loginAdmin(identity.email, 'synthetic-password', false);
    const read = api.staffRequest();
    await started;
    await api.logoutAdmin();
    assert.equal(api.getSession().status, 'anonymous');
    assert.equal(api.getSession().user, null);
    if (replacement !== 'none') {
      currentIdentity = nextIdentity;
      await api.loginAdmin(nextIdentity.email, 'synthetic-password', false);
      assert.equal(api.getSession().status, 'authenticated');
      assert.equal(api.getSession().user.id, nextIdentity.id);
      assert.ok(api.getSession().user.permissions.includes('staff.manage'));
    }
    const rejected = assert.rejects(read, (error) =>
      error instanceof api.SessionError && error.status === 401 && /session changed/i.test(error.message));
    release({ items: [{ id: 'synthetic-staff-id', name: 'Previous session protected staff' }] });
    await rejected;
    assert.equal(api.getSession().status, replacement === 'none' ? 'anonymous' : 'authenticated');
    assert.equal(api.getSession().user?.id, replacement === 'none' ? undefined : nextIdentity.id);
  });
}

test('staff search is a no-store body-only read, safely retryable and never replayed automatically', async () => {
  let searches = 0;
  const identity = { ...user, permissions: ['admin.access', 'staff.manage'] };
  const api = await setup(async (url, options) => {
    if (url.includes('/admin/staff')) {
      searches++;
      assert.equal(url, '/api/v1/admin/staff/search');
      assert.equal(options.method, 'POST');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
      assert.deepEqual(JSON.parse(options.body), { query: 'fictional-search-term', cursor: null, limit: 100 });
      if (searches === 1) throw Error('private outage detail');
      return reply({ items: [], has_more: false, next_cursor: null, scanned: 0, scan_limit: 500, limit: 100 });
    }
    return reply(url.endsWith('/me') ? identity : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const body = { query: 'fictional-search-term', cursor: null, limit: 100 };
  await assert.rejects(api.staffRequest('/search', body), (error) => !error.ambiguous && /retry/i.test(error.message));
  assert.equal(searches, 1);
  assert.deepEqual((await api.staffRequest('/search', body)).items, []);
  assert.equal(searches, 2);
  await api.logoutAdmin();
});

test('replacement is terminal only for a previously verified tab and never restores a newer cookie', async () => {
  let replaced = false;
  let refreshes = 0;
  const api = await setup(async (url) => {
    if (url.endsWith('/refresh')) refreshes++;
    if (replaced && url.endsWith('/me')) return new Response('{}', {
      status: 401, headers: { 'X-Session-Reason': 'replaced' },
    });
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  replaced = true;
  await api.verifySession(true);
  assert.equal(api.getSession().status, 'anonymous');
  assert.equal(api.getSession().user, null);
  assert.match(api.getSession().message, /signed in elsewhere/);
  await api.verifySession();
  assert.match(api.getSession().message, /signed in elsewhere/);
  assert.equal(refreshes, 0);
  replaced = false;
  await api.loginAdmin(user.email, 'synthetic-password', false);
  assert.equal(api.getSession().message, '');
  await api.logoutAdmin();
});

test('refresh replacement notice needs a previous identity; login, expiry and unknown reasons stay generic', async () => {
  for (const initial of [true, false]) {
    let denied = initial;
    const api = await setup(async (url) => {
      if (denied) return new Response('{"private":"never display"}', {
        status: 401, headers: { 'X-Session-Reason': url.endsWith('/refresh') ? 'replaced' : 'unknown' },
      });
      return reply(url.endsWith('/me') ? user : payload);
    });
    if (!initial) await api.loginAdmin(user.email, 'synthetic-password', false);
    denied = true;
    await api.verifySession(true);
    assert.equal(api.getSession().status, 'anonymous');
    assert.equal(api.getSession().user, null);
    assert.equal(api.getSession().message.includes('signed in elsewhere'), !initial);
    await assert.rejects(api.loginAdmin(user.email, 'synthetic-password', false));
    assert.ok(!api.getSession().message.includes('signed in elsewhere'));
    assert.ok(!api.getSession().message.includes('private'));
  }
});

test('login sends bounded cookie request, verifies permission via me and allowlists identity', async () => {
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', true);
  assert.equal(api.getSession().status, 'authenticated');
  assert.equal(api.getSession().user.password_hash, undefined);
  assert.deepEqual(JSON.parse(calls[0][1].body), { identifier: user.email, password: 'synthetic-password', remember_me: true, identity_kind: 'admin' });
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

test('activity is credential-private metadata with keepalive and no GET query payload', async () => {
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/reporting/activity')) return reply(null, 204);
    if (url.endsWith('/logout')) return reply(null, 204);
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const events = [{ event_id: '00000000-0000-4000-8000-000000000001', action: 'created', resource: 'zone' }];
  assert.equal(await api.reportingRequest('activity', { events }), null);
  const [url, options] = calls.at(-1);
  assert.equal(url, '/api/v1/admin/reporting/activity');
  assert.equal(options.method, 'POST');
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { events });
  assert.equal(options.headers.Authorization, 'Bearer synthetic-memory-token');
  await api.logoutAdmin();
});

test('logout clears authorization immediately but lets dispatched activity finish before revocation', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/reporting/activity')) { await gate; return reply(null, 204); }
    if (url.endsWith('/logout')) return reply(null, 204);
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const reporting = api.reportingRequest('activity', { events: [{ event_id: '00000000-0000-4000-8000-000000000001', action: 'page_view', resource: 'dashboard' }] });
  const closing = api.logoutAdmin({ beforeRevoke: reporting });
  assert.equal(api.getSession().status, 'anonymous');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!calls.some(([url]) => url.endsWith('/logout')));
  release();
  await assert.rejects(reporting);
  assert.equal(await closing, true);
  assert.equal(calls.at(-1)[0], '/api/v1/auth/logout');
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), {});
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

test('reports use narrow no-store reads and serialize renewal with a single retry', async () => {
  let refreshes = 0;
  let fail = true;
  const calls = [];
  const api = await setup(async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/reporting/')) {
      if (fail) return reply({}, 401);
      return reply({ items: [], limit: 20, offset: 0, has_more: false });
    }
    if (url.endsWith('/refresh')) { refreshes++; fail = false; return reply(payload); }
    return reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const results = await Promise.allSettled([
    api.reportingRequest('events', { limit: 20 }), api.reportingRequest('sessions', {}),
  ]);
  assert.equal(refreshes, 1);
  assert.ok(results.every((r) => r.status === 'fulfilled'));
  const report = calls.find(([url]) => url.includes('/reporting/'));
  assert.equal(report[1].method, 'GET');
  assert.equal(report[1].cache, 'no-store');
  assert.equal(report[1].body, undefined);
  assert.equal(report[1].headers.Authorization, 'Bearer synthetic-memory-token');
  await assert.rejects(api.reportingRequest('../auth/login'), /Unsupported/);
  await assert.rejects(api.reportingRequest('events', { password: 'no' }), /Unsupported/);
  await api.logoutAdmin();
});

test('an export identity guard cannot authorize a later login of even the same user', async () => {
  const api = await setup(async (url) => url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? user : payload));
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const guard = api.reportingIdentityGuard();
  guard();
  await api.verifySession(true);
  guard(); // token rotation within the original login is allowed
  await api.logoutAdmin();
  assert.throws(guard, /session changed/);
  await api.loginAdmin(user.email, 'synthetic-password', false);
  assert.throws(guard, /session changed/);
  api.reportingIdentityGuard()();
  await api.logoutAdmin();
});

test('session exports permit state and search filters but never pagination or event-only extras', async () => {
  const calls = [];
  const api = await setup(async (url) => {
    calls.push(url);
    if (url.includes('/reporting/')) return reply({ rows: [] });
    return url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  await api.reportingRequest('sessions/export', { q: 'literal search', state: 'REVOKED' });
  const query = new URL(calls.at(-1), 'https://example.test').searchParams;
  assert.equal(query.get('q'), 'literal search');
  assert.equal(query.get('state'), 'REVOKED');
  await assert.rejects(api.reportingRequest('sessions/export', { offset: 25 }), /Unsupported/);
  await assert.rejects(api.reportingRequest('events/export', { state: 'REVOKED' }), /Unsupported/);
  for (const resource of ['events', 'events/export']) {
    await api.reportingRequest(resource, { q: 'Browser-reported %_/', user_id: user.id, start: '2030-02-02T00:00:00Z' });
    const eventQuery = new URL(calls.at(-1), 'https://example.test').searchParams;
    assert.equal(eventQuery.get('q'), 'Browser-reported %_/');
    assert.equal(eventQuery.get('user_id'), user.id);
    assert.equal(eventQuery.get('start'), '2030-02-02T00:00:00Z');
  }
  await assert.rejects(api.reportingRequest('events/export', { limit: 25 }), /Unsupported/);
  await api.logoutAdmin();
});

test('reports reject late data after logout or identity change, including body decode races', async () => {
  for (const lateBody of [false, true]) {
    let release, started;
    const start = new Promise((resolve) => { started = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const api = await setup(async (url) => {
      if (url.includes('/reporting/')) {
        if (lateBody) return { ok: true, status: 200, json: async () => { started(); await gate; return { private: true }; } };
        started(); await gate; return reply({ private: true });
      }
      return url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? user : payload);
    });
    await api.loginAdmin(user.email, 'synthetic-password', false);
    const reading = api.reportingRequest('summary');
    await start;
    await api.logoutAdmin();
    release();
    await assert.rejects(reading, /session changed/);
    await assert.rejects(api.reportingRequest('summary'), /session changed/);
  }
});

test('report aborts and terminal permissions fail closed, no refresh loop or unsafe messages', async () => {
  let status = 200, refreshes = 0;
  const api = await setup(async (url) => {
    if (url.includes('/reporting/')) return reply({ secret: 'never display' }, status);
    if (url.endsWith('/refresh')) refreshes++;
    return url.endsWith('/logout') ? reply(null, 204) : reply(url.endsWith('/me') ? user : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(api.reportingRequest('events', {}, { signal: ctl.signal }), { name: 'AbortError' });
  status = 403;
  await assert.rejects(api.reportingRequest('summary'), { status: 403 });
  assert.equal(api.getSession().status, 'anonymous');
  assert.equal(refreshes, 0);
  await api.loginAdmin(user.email, 'synthetic-password', false);
  status = 401;
  await assert.rejects(api.reportingRequest('summary'), { status: 401 });
  assert.equal(refreshes, 1);
  assert.equal(api.getSession().status, 'anonymous');
});

test('a report for an earlier login cannot be returned to a different identity', async () => {
  let release, start, nextUser = user;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { start = resolve; });
  const api = await setup(async (url) => {
    if (url.includes('/reporting/')) { start(); await gate; return reply({ private: true }); }
    return url.endsWith('/logout') ? reply(null, 204)
      : reply(url.endsWith('/me') ? nextUser : payload);
  });
  await api.loginAdmin(user.email, 'synthetic-password', false);
  const reading = api.reportingRequest('summary');
  await started;
  nextUser = { ...user, id: 'different-synthetic-id' };
  await api.loginAdmin(nextUser.email, 'synthetic-password', false);
  release();
  await assert.rejects(reading, /session changed/);
  assert.equal(api.getSession().user.id, nextUser.id);
  await api.logoutAdmin();
});