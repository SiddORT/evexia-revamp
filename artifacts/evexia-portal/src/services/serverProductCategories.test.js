import assert from 'node:assert/strict';
import test from 'node:test';
import { validCategoryPrice, validateProductCategory } from './productCategoryValidation.js';

test('exact plain category price validation never uses binary floats', () => {
  for (const value of ['0', '125.5', '0.000001', '999999999999.999999']) assert.equal(validCategoryPrice(value), true);
  for (const value of ['-1', 'NaN', 'Infinity', '1e2', '1000000000000', '0.0000001', '', 125.5]) assert.equal(validCategoryPrice(value), false);
  assert.deepEqual(validateProductCategory({ name: 'Name', description: '', unit_price: '125.5', status: 'active' }), {});
});

test('Category authenticated transport versions, transfers, uncertain writes and identity decoding guards', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  const record = { id: '00000000-0000-0000-0000-000000000001', name: 'City', description: '', unit_price: '125.500000', status: 'active', version: 4 };
  let mode = '';
  let release, arrived;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/product-categories')) {
      calls.push({ url, options });
      if (mode === 'uncertain') throw new TypeError('synthetic connection loss');
      if (mode === 'invalid-json') return { ok: true, status: 200, json: async () => { throw new Error('synthetic decode'); } };
      if (mode === 'decode') return { ok: true, status: 200, json: () => { arrived(); return new Promise((resolve) => { release = () => resolve(record); }); } };
      if (url.includes('/export') || url.includes('/sample')) return new Response('file bytes', { headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 2 }
        : url.includes('/import/review') ? { valid: true, rows: [], digest: 'confirmation' }
        : options.method === 'GET' && url.includes('limit=') ? { items: [record], total: 10, filtered: 2 } : record));
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { user, access_token: 'synthetic-token', expires_in: 900 }),
      { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverProductCategories.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  assert.equal((await service.listProductCategories({ query: 'CI', status: 'inactive', min_price: '0', max_price: '125.5', limit: 2, offset: 2 })).filtered, 2);
  assert.match(calls[0].url, /query=CI&status=inactive&min_price=0&max_price=125.5&limit=2&offset=2/);
  await service.createProductCategory({ name: 'New', status: 'active' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'New', status: 'active' });
  await service.getProductCategory(record.id);
  await service.editProductCategory(record, { name: 'Revised', description: 'Description', unit_price: '999999999999.999999', status: 'inactive' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { name: 'Revised', description: 'Description', unit_price: '999999999999.999999', status: 'inactive', expected_version: 4 });
  await service.statusProductCategory(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'inactive', expected_version: 4 });
  await service.deleteProductCategory(record);
  assert.deepEqual(JSON.parse(calls[5].options.body), { expected_version: 4 });
  const file = Object.assign(new Blob(['Product Category Name,Description,Unit Price,Status\nName,,0,active']), { name: 'hq.csv' });
  assert.equal((await service.reviewProductCategories(file)).digest, 'confirmation');
  assert.equal(calls[6].options.body, file);
  assert.deepEqual(await service.importProductCategories(file, 'confirmation'), { imported: 2 });
  assert.match(calls[7].url, /digest=confirmation&confirm=true/);
  const controller = new AbortController();
  const blob = await service.exportProductCategories({ query: 'CI', status: 'inactive' }, 'xlsx', controller.signal);
  assert.equal(await blob.text(), 'file bytes');
  assert.match(calls[8].url, /query=CI&status=inactive&format=xlsx/);
  assert.match(calls[8].options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
  assert.equal(await (await service.sampleProductCategories('csv')).text(), 'file bytes');
  assert.match(calls[9].url, /\/sample\?format=csv/);
  controller.abort();
  await assert.rejects(service.exportProductCategories({}, 'csv', controller.signal), /abort/i);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.cache, 'no-store');
  }
  mode = 'uncertain';
  const before = calls.length;
  await assert.rejects(service.editProductCategory(record, { name: 'Unsure', status: 'active' }), (error) => error.ambiguous);
  assert.equal(calls.length, before + 1, 'Never replay an uncertain write');
  mode = 'invalid-json';
  await assert.rejects(service.deleteProductCategory(record), (error) => error.ambiguous);
  mode = 'decode';
  const started = new Promise((resolve) => { arrived = resolve; });
  const late = service.getProductCategory(record.id);
  await started;
  await session.logoutAdmin();
  release();
  await assert.rejects(late, /session changed/i);
  assert.throws(() => session.serverDownloadGuard(blob), /session changed/i);
});
