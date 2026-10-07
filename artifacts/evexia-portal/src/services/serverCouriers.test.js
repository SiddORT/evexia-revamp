import assert from 'node:assert/strict';
import { test } from 'node:test';

test('courier service sends real filters, versions, review confirmations and downloads', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { locks: { request: async (_key, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  const record = { id: '00000000-0000-0000-0000-000000000001', name: 'City', status: 'active', version: 4 };
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/courier-partners')) {
      calls.push({ url, options });
      if (url.includes('/export')) return new Response('CSV download');
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 2 }
        : url.includes('/import/review') ? { valid: true, rows: [], digest: 'confirmation' }
        : options.method === 'GET' && url.includes('limit=') ? { items: [record], total: 10, filtered: 2 }
        : record));
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user
      : { user, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverCouriers.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  assert.deepEqual(await service.listCouriers({ query: 'City', status: 'inactive', limit: 2, offset: 2 }),
    { items: [record], total: 10, filtered: 2 });
  assert.match(calls[0].url, /query=City&status=inactive&limit=2&offset=2/);
  await service.createCourier({ name: 'New', status: 'active' });
  await service.getCourier(record.id);
  await service.editCourier(record, { name: 'Revised', status: 'inactive' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { name: 'Revised', status: 'inactive', expected_version: 4 });
  await service.statusCourier(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'inactive', expected_version: 4 });
  await service.deleteCourier(record);
  assert.deepEqual(JSON.parse(calls[5].options.body), { expected_version: 4 });
  const file = Object.assign(new Blob(['Courier Partner Name,Status\nName,active']), { name: 'couriers.csv' });
  assert.equal((await service.reviewCouriers(file)).digest, 'confirmation');
  assert.equal(calls[6].options.body, file);
  assert.deepEqual(await service.importCouriers(file, 'confirmation'), { imported: 2 });
  assert.match(calls[7].url, /digest=confirmation&confirm=true/);
  assert.equal(await (await service.exportCouriers({ query: 'City', status: 'inactive' }, 'csv')).text(), 'CSV download');
  assert.match(calls[8].url, /query=City&status=inactive&format=csv/);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.cache, 'no-store');
  }
  await session.logoutAdmin();
});
