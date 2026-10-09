import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Allergen authenticated transport, references, transfers and exact decimals', async (t) => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_k, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  const record = { id: '00000000-0000-0000-0000-000000000001', name: 'Pollen', version: 3, mix: true };
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/allergens')) {
      calls.push({ url, options });
      if (url.includes('/export') || url.includes('/sample')) return new Response('bytes', { headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 2 } : url.includes('/import/review') ? { valid: true, rows: [], digest: 'd' }
        : url.includes('/references/') ? { items: [], total: 0, limit: 25, offset: 0 } : url.includes('limit=') ? { items: [record], total: 1, filtered: 1 } : record));
    }
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { user, access_token: 't', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  t.after(() => session.logoutAdmin());
  const s = await import('./serverAllergens.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  await s.listAllergens({ query: 'a', status: 'all', mix: 'mix', min_price: '0.1000001', limit: 10, offset: 0 });
  assert.match(calls[0].url, /min_price=0.1000001/);
  await s.editAllergen(record, { name: 'X' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'X', expected_version: 3 });
  await s.statusAllergen(record, 'inactive');
  await s.deleteAllergen(record);
  assert.deepEqual(JSON.parse(calls[3].options.body), { expected_version: 3 });
  await s.listAllergenReferences('categories', { query: 'q' });
  assert.match(calls[4].url, /\/references\/categories\?limit=25&offset=0&include_unusable=false&query=q/);
  assert.throws(() => s.listAllergenReferences('other', {}));
  const file = Object.assign(new Blob(['x']), { name: 'a.csv' });
  await s.reviewAllergens(file);
  assert.equal(calls[5].options.body, file);
  assert.deepEqual(await s.importAllergens(file, 'd'), { imported: 2 });
  assert.match(calls[6].url, /digest=d&confirm=true/);
  await s.exportAllergens({ status: 'all' }, 'xlsx');
  assert.match(calls.at(-1).url, /\/export\?status=all&format=xlsx/);
  assert.equal(s.compareDecimal('0.100001', '0.100000'), 1);
  assert.deepEqual(s.validatePriceBounds('2', '1.999999'), { max: 'Maximum price must not be below minimum price.' });
  assert.deepEqual(s.validatePriceBounds('1.000000', '1'), {});
  assert.deepEqual(s.validateAllergen({ name: 'A', category_id: 'c', storage_location_id: 'l', selling_price: '', gst: '100.000001', concentration: 'x', threshold_limit: '', status: 'active', mix: false }), { gst: 'GST must be between 0 and 100 with up to 6 decimals.' });
  await assert.rejects(session.allergenRequest('/bogus'));
  await session.logoutAdmin();
});

test('Allergen cannot expose decoded responses or accepted downloads across identity changes', async (t) => {
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverAllergens.js');
  let user = { id: 'owner-a', email: 'a@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  let resource;
  globalThis.fetch = async (url) => {
    if (url.includes('/admin/allergens')) return resource();
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { access_token: 'fixture', expires_in: 900 }),
      { status: url.endsWith('/logout') ? 204 : 200 });
  };
  t.after(() => session.logoutAdmin());
  await session.loginAdmin(user.email, 'synthetic', false);
  const ready = Promise.withResolvers(), release = Promise.withResolvers();
  resource = () => ({ ok: true, status: 200, json: async () => {
    ready.resolve();
    await release.promise;
    return { private: 'former owner catalogue' };
  } });
  const pending = service.listAllergens({ status: 'all', limit: 10, offset: 0 });
  await ready.promise;
  await session.logoutAdmin();
  user = { ...user, id: 'owner-b' };
  await session.loginAdmin(user.email, 'synthetic', false);
  release.resolve();
  await assert.rejects(pending, error => error.status === 401 && !error.message.includes('former owner'));
  resource = () => new Response('file', { headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
  const accepted = await service.sampleAllergens('xlsx');
  await session.logoutAdmin();
  assert.throws(() => session.serverDownloadGuard(accepted), /session changed/);
  await session.loginAdmin(user.email, 'synthetic', false);
  resource = () => new Response('unlogged file');
  await assert.rejects(service.sampleAllergens('csv'), /logging could not be confirmed/);
  let dispatched = 0;
  resource = () => { dispatched++; return new Response('{}'); };
  await session.logoutAdmin();
  user = { ...user, system_role: null, identity_kind: 'staff', permissions: ['workspace.access', 'zone.add', 'zone.export', 'zone.import'] };
  await session.loginAdmin(user.email, 'synthetic', false);
  for (const call of [() => service.listAllergens({}), () => service.listAllergenReferences('categories', {}),
    () => service.sampleAllergens('csv'), () => service.reviewAllergens(Object.assign(new Blob(['x']), { name: 'x.csv' }))]) {
    await assert.rejects(call(), error => error.status === 403);
  }
  assert.equal(dispatched, 0);
});

test('Allergen rejected writes renew without replay; same-owner reads may retry', async (t) => {
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverAllergens.js');
  const user = { id: 'renew-owner', email: 'a@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  let writes = 0, reads = 0, refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/allergens')) {
      if (options.method === 'POST') { writes++; return new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }); }
      reads++;
      return new Response(JSON.stringify(reads === 1 ? { error: { message: 'expired' } } : { items: [] }), { status: reads === 1 ? 401 : 200 });
    }
    if (url.endsWith('/refresh')) refreshes++;
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { access_token: 'renew-fixture', expires_in: 900 }),
      { status: url.endsWith('/logout') ? 204 : 200 });
  };
  t.after(() => session.logoutAdmin());
  await session.loginAdmin(user.email, 'synthetic', false);
  await assert.rejects(service.createAllergen({ name: 'preserved draft' }), /Session renewed.*draft is preserved/);
  assert.equal(writes, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(await service.listAllergens({}), { items: [] });
  assert.equal(reads, 2);
  assert.equal(refreshes, 2);
});
