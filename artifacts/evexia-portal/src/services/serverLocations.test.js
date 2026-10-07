import assert from 'node:assert/strict';
import { test } from 'node:test';

test('location service sends real filters, versions, review confirmations and downloads', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { locks: { request: async (_key, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  const record = { id: '00000000-0000-0000-0000-000000000001', name: 'City', address: 'Building A', status: 'active', version: 4 };
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/storage-locations')) {
      calls.push({ url, options });
      if (url.includes('/export')) return new Response('CSV download', { headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 2 }
        : url.includes('/import/review') ? { valid: true, rows: [], digest: 'confirmation' }
        : options.method === 'GET' && url.includes('limit=') ? { items: [record], total: 10, filtered: 2 }
        : record));
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user
      : { user, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverLocations.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  assert.deepEqual(await service.listLocations({ query: 'City', status: 'inactive', limit: 2, offset: 2 }),
    { items: [record], total: 10, filtered: 2 });
  assert.match(calls[0].url, /query=City&status=inactive&limit=2&offset=2/);
  await service.createLocation({ name: 'New', address: 'Building A', status: 'active' });
  await service.getLocation(record.id);
  await service.editLocation(record, { name: 'Revised', address: 'Building B', status: 'inactive' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { name: 'Revised', address: 'Building B', status: 'inactive', expected_version: 4 });
  await service.statusLocation(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'inactive', expected_version: 4 });
  await service.deleteLocation(record);
  assert.deepEqual(JSON.parse(calls[5].options.body), { expected_version: 4 });
  const file = Object.assign(new Blob(['Storage Location,Address,Status\nName,Building A,active']), { name: 'locations.csv' });
  assert.equal((await service.reviewLocations(file)).digest, 'confirmation');
  assert.equal(calls[6].options.body, file);
  assert.deepEqual(await service.importLocations(file, 'confirmation'), { imported: 2 });
  assert.match(calls[7].url, /digest=confirmation&confirm=true/);
  assert.equal(await (await service.exportLocations({ query: 'City', status: 'inactive' }, 'csv')).text(), 'CSV download');
  assert.match(calls[8].url, /query=City&status=inactive&format=csv/);
  assert.match(calls[8].options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
  const controller = new AbortController();
  await service.exportLocations({ query: 'Building A', status: 'all' }, 'xlsx', controller.signal);
  assert.match(calls[9].url, /query=Building\+A&status=all&format=xlsx/);
  assert.equal(calls[9].options.signal.aborted, false);
  controller.abort();
  assert.equal(calls[9].options.signal.aborted, true);
  const previousCalls = calls.length;
  await assert.rejects(service.exportLocations({ query: 'City' }, 'csv', controller.signal), /abort/i);
  assert.equal(calls.length, previousCalls);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.cache, 'no-store');
  }
  const originalFetch = globalThis.fetch;
  let release, started;
  const arrived = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/storage-locations')) {
      started();
      return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify(record))); });
    }
    return originalFetch(url, options);
  };
  const late = service.getLocation(record.id);
  await arrived;
  await session.logoutAdmin();
  release();
  await assert.rejects(late, /session changed/i);
});
