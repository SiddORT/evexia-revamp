import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const ID = '00000000-0000-4000-8000-000000000009';
const staff = (permissions, extra = {}) => ({ id: 'staff-1', email: null, username: 'asha', system_role: null, identity_kind: 'staff', permissions, ...extra });
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Download-Log': '00000000-0000-4000-8000-000000000001' } });
let index = 0;
const apis = [];
after(async () => { for (const api of apis) await api.logoutAdmin().catch(() => {}); });
async function setup(identity, extra = () => null) {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_n, work) => work() } } });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).endsWith('/auth/login') || String(url).endsWith('/auth/refresh')) return reply({ access_token: 't', expires_in: 600 });
    if (String(url).endsWith('/auth/me')) return reply(identity);
    return extra(String(url), init) || reply({ items: [], has_more: false });
  };
  const api = await import(`./adminSession.js?staff=${index++}`);
  apis.push(api);
  await api.loginAdmin('asha', 'pw', false);
  return { api, calls };
}

test('verified staff without admin.access is admitted with filtered permissions and nullable email', async () => {
  const { api } = await setup(staff(['workspace.access', 'zone.add', 'admin.x', 'staff.manage']));
  const user = api.getSession().user;
  assert.equal(api.getSession().status, 'authenticated');
  assert.equal(user.identity_kind, 'staff');
  assert.equal(user.email, null);
  assert.deepEqual([...user.permissions], ['workspace.access', 'zone.add']);
  await api.logoutAdmin();
});

test('staff identities are refused when they claim admin.access, a system role or lack workspace.access', async () => {
  for (const identity of [staff(['workspace.access', 'admin.access']), staff(['workspace.access'], { system_role: 'super_admin' }), staff(['zone.add']), staff(['workspace.access'], { identity_kind: 'mr' })]) {
    await assert.rejects(setup(identity), /Admin access/);
  }
});

test('zone transport authorizes per action; trash, restore and other services stay denied', async () => {
  const { api, calls } = await setup(staff(['workspace.access', 'zone.import', 'zone.export']));
  await api.zoneRequest('', {});
  await api.zoneRequest('/export', { params: { format: 'csv' }, download: true });
  await assert.rejects(api.zoneRequest('', { body: { name: 'x' } }), /denied/);
  await assert.rejects(api.zoneRequest(`/${ID}/edit`, { body: {} }), /denied/);
  await assert.rejects(api.zoneRequest(`/${ID}/status`, { body: {} }), /denied/);
  await assert.rejects(api.zoneRequest(`/${ID}/delete`, { body: {} }), /denied/);
  await assert.rejects(api.zoneRequest('/trash', {}), /denied/);
  await assert.rejects(api.zoneRequest(`/${ID}/restore`, { body: {} }), /denied/);
  await assert.rejects(api.courierRequest('', {}), /denied/);
  await assert.rejects(api.locationRequest('', {}), /denied/);
  await api.zoneRequest('/import/review', { file: new Uint8Array(1), params: { filename: 'a.csv' } });
  assert.equal(api.getSession().status, 'authenticated');
  assert.equal(calls.filter(([u]) => u.includes('/admin/zones')).length, 3);
});

test('edit grant alone cannot add, import or export; import is independent of add', async () => {
  const { api } = await setup(staff(['workspace.access', 'zone.edit']));
  await api.zoneRequest(`/${ID}/edit`, { body: {} });
  await assert.rejects(api.zoneRequest('', { body: {} }), /denied/);
  await assert.rejects(api.zoneRequest('/import/commit', { file: new Uint8Array(1), params: {} }), /denied/);
  await assert.rejects(api.zoneRequest('/export', { params: {}, download: true }), /denied/);
});

test('staff reporting is limited to zone sample initiation with zone.import', async () => {
  const sample = { initiation_id: ID, source: 'zone', kind: 'sample', format: 'CSV' };
  const { api, calls } = await setup(staff(['workspace.access', 'zone.import']));
  await api.reportingRequest('downloads/initiate', sample);
  for (const [resource, params] of [['downloads', {}], ['summary', {}], ['activity', { events: [] }], ['downloads/initiate', { ...sample, kind: 'export' }], ['downloads/initiate', { ...sample, source: 'courier' }]]) {
    await assert.rejects(api.reportingRequest(resource, params), /denied/);
  }
  assert.equal(calls.filter(([u]) => u.includes('/reporting/')).length, 1);
  const none = await setup(staff(['workspace.access', 'zone.export']));
  await assert.rejects(none.api.reportingRequest('downloads/initiate', sample), /denied/);
});

test('staff and role transports admit only the new permission/access paths for managers', async () => {
  const { api } = await setup(staff(['workspace.access', 'zone.add']));
  await assert.rejects(api.staffRequest(`/${ID}/access`, {}), /denied/);
  await assert.rejects(api.roleRequest(`/${ID}/permissions`, {}), /denied/);
  await assert.rejects(api.roleRequest('/permissions', {}), /Unsupported/);
  await assert.rejects(api.staffRequest('/access', {}), /Unsupported/);
});

test('capability helpers', async () => {
  const c = await import('./capabilities.js');
  const u = staff(['workspace.access', 'zone.export']);
  assert.equal(c.canViewZones(u), true);
  assert.equal(c.canViewZones(staff(['workspace.access'])), false);
  assert.equal(c.hasZonePermission(u, 'zone.add'), false);
  assert.equal(c.staffPathAllowed('/admin/masters/zones'), true);
  for (const path of ['/admin/masters/zones/', '/admin/staff', '/admin/settings', '/admin/masters/import/mr', '/admin/masters/zones/trash']) assert.equal(c.staffPathAllowed(path), false);
});

test('staff transient renewal retains verified identity for mounted drafts but does not authorize actions', async () => {
  const identity = staff(['workspace.access', 'zone.import']);
  const { api } = await setup(identity);
  const verified = api.getSession().user;
  globalThis.fetch = async (url) => String(url).endsWith('/auth/me')
    ? reply(identity) : reply({ error: { message: 'Temporarily unavailable' } }, 503);
  await api.verifySession(true);
  assert.equal(api.getSession().status, 'renewal-error');
  assert.equal(api.getSession().user, verified);
  await assert.rejects(api.zoneRequest('/import/review', { file: new Uint8Array(1) }), /session changed/i);
  globalThis.fetch = async (url) => String(url).endsWith('/auth/me')
    ? reply(staff(['workspace.access'])) : reply({ access_token: 'renewed', expires_in: 600 });
  await api.verifySession(true);
  assert.equal(api.getSession().status, 'authenticated');
  assert.deepEqual([...api.getSession().user.permissions], ['workspace.access']);
  await assert.rejects(api.zoneRequest('', {}), /denied/);
});

test('a server Zone denial refreshes current grants without replay or claiming success', async () => {
  const { api } = await setup(staff(['workspace.access', 'zone.add', 'zone.edit']));
  let deniedRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/me')) return reply(staff(['workspace.access', 'zone.add']));
    deniedRequests++;
    return reply({ error: { code: 'permission_denied', message: 'Zone access denied' } }, 403);
  };
  await assert.rejects(api.zoneRequest(`/${ID}/edit`, { body: {} }), /denied/);
  assert.equal(deniedRequests, 1);
  assert.deepEqual([...api.getSession().user.permissions], ['workspace.access', 'zone.add']);
  await assert.rejects(api.zoneRequest(`/${ID}/edit`, { body: {} }), /denied/);
  assert.equal(deniedRequests, 1);
});
