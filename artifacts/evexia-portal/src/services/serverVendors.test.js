import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vendorDraftErrors, vendorPhone, vendorTel, EMPTY_VENDOR } from './vendorFields.js';
import { VENDOR_COUNTRIES, normalizeVendorPhone } from './vendorPhone.js';
import { DIAL_COUNTRIES } from './phoneCountries.js';

test('vendor catalogue distinguishes shared calling codes and validates variable national lengths', () => {
  assert.ok(VENDOR_COUNTRIES.length > 240);
  assert.deepEqual(DIAL_COUNTRIES.map((c) => c.value), ['IN', 'US', 'GB', 'AE']);
  const labels = VENDOR_COUNTRIES.filter((c) => c.code === '+1').map((c) => c.label);
  assert.ok(labels.includes('Canada (CA) +1'));
  assert.ok(labels.includes('United States (US) +1'));
  for (const [country, phone, normalized] of [
    ['CA', '(506) 234-5678', '5062345678'], ['SG', '6123 4567', '61234567'],
    ['DE', '030 123456', '30123456'], ['BR', '(11) 96123-4567', '11961234567'],
    ['IT', '02 1234 5678', '0212345678'], ['SH', '22158', '22158'],
  ]) {
    assert.equal(normalizeVendorPhone(phone, country), normalized);
    assert.equal(normalizeVendorPhone(normalized, country), normalized);
  }
  assert.equal(normalizeVendorPhone('+1 2025550123', 'CA'), null);
  assert.equal(normalizeVendorPhone('123', 'SG'), null);
});

test('vendor phone countries use staff rules without unknown country fallback', () => {
  const valid = { ...EMPTY_VENDOR, vendorName: 'Supply', gstNo: '27DDDDD3333D1Z8',
    registeredAddress: 'Address', contactPersonName: 'Contact', emailId: 'contact@example.test' };
  for (const [dialCountry, phoneNo, rendered] of [
    ['IN', '+91 98765-43210', '+91 9876543210'], ['US', '(202) 555-0123', '+1 2025550123'],
    ['GB', '7700 900123', '+44 7700900123'], ['AE', '50 123 4567', '+971 501234567']]) {
    assert.deepEqual(vendorDraftErrors({ ...valid, dialCountry, phoneNo }), {});
    const record = { dialCountry, phoneNo: phoneNo.replace(/^\+91[\s-]?/, '').replace(/[\s()-]/g, '') };
    assert.equal(vendorPhone(record), rendered);
    assert.equal(vendorTel(record), rendered.replace(' ', ''));
  }
  assert.ok(vendorDraftErrors({ ...valid, phoneNo: '1234567890' }).phoneNo);
  assert.ok(vendorDraftErrors({ ...valid, dialCountry: 'ZZ', phoneNo: '9876543210' }).dialCountry);
  assert.throws(() => vendorPhone({ dialCountry: 'ZZ', phoneNo: '123' }), /unsupported/);
  assert.ok(vendorDraftErrors({ ...valid, registeredAddress: 'x'.repeat(2001) }).registeredAddress);
});

test('vendor transport preserves filters, country, versions, confirmations and fail-closed downloads', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { locks: { request: async (_key, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const fields = { vendorName: 'Supply', gstNo: '27DDDDD3333D1Z8', registeredAddress: 'Address',
    contactPersonName: 'Contact', emailId: 'contact@example.test', phoneNo: '501234567', dialCountry: 'AE', status: 'active' };
  const record = { ...fields, id: '00000000-0000-0000-0000-000000000001', version: 4 };
  const calls = [];
  let missingEvidence = false, responseError = null, expireNext = false;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/vendors')) {
      calls.push({ url, options });
      if (expireNext) { expireNext = false; return new Response('{}', { status: 401 }); }
      if (responseError) return new Response(JSON.stringify(responseError), { status: 422 });
      if (/\/(?:sample|export)\?/.test(url)) return new Response('accepted file', { headers: missingEvidence ? {} : { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 1 }
        : url.includes('/import/review') ? { valid: true, rows: [], digest: 'confirmation' }
        : options.method === 'GET' && url.includes('limit=') ? { items: [record], total: 12, filtered: 11 } : record));
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user
      : { user, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverVendors.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  assert.equal((await service.listVendors({ query: 'Supply %', status: 'inactive', limit: 2, offset: 2 })).filtered, 11);
  assert.match(calls[0].url, /query=Supply\+%25&status=inactive&limit=2&offset=2/);
  await service.createVendor(fields);
  assert.deepEqual(JSON.parse(calls[1].options.body), fields);
  await service.getVendor(record.id);
  await service.editVendor(record, { ...fields, status: 'inactive' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { ...fields, status: 'inactive', expected_version: 4 });
  await service.statusVendor(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'inactive', expected_version: 4 });
  await service.deleteVendor(record);
  assert.deepEqual(JSON.parse(calls[5].options.body), { expected_version: 4 });
  const file = Object.assign(new Blob(['local bytes']), { name: 'vendors.xlsx' });
  assert.equal((await service.reviewVendors(file)).digest, 'confirmation');
  assert.equal(calls[6].options.body, file);
  await service.importVendors(file, 'confirmation');
  assert.match(calls[7].url, /filename=vendors.xlsx&digest=confirmation&confirm=true/);
  assert.equal(await (await service.exportVendors({ query: 'Supply', status: 'inactive' }, 'csv')).text(), 'accepted file');
  assert.match(calls[8].url, /query=Supply&status=inactive&format=csv/);
  const blob = await service.sampleVendors('xlsx');
  assert.match(calls[9].url, /sample\?format=xlsx/);
  session.serverDownloadGuard(blob);
  assert.throws(() => session.serverDownloadGuard(blob), /acceptance is missing/i);
  missingEvidence = true;
  await assert.rejects(service.exportVendors({}, 'xlsx'), /logging could not be confirmed/);
  await assert.rejects(service.sampleVendors('csv'), /logging could not be confirmed/);
  missingEvidence = false;
  responseError = { error: { message: 'Invalid request', fields: [{ field: 'body.phoneNo', code: 'value_error' }] } };
  await assert.rejects(service.createVendor(fields), (cause) => Boolean(cause.fields?.phoneNo));
  responseError = null;
  expireNext = true;
  const before = calls.length;
  await assert.rejects(service.createVendor(fields), /draft is preserved/);
  assert.equal(calls.length, before + 1); // no write replay after renewal
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.cache, 'no-store');
  }
  const originalFetch = globalThis.fetch;
  let release, started;
  const arrived = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/vendors')) {
      started();
      return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify(record))); });
    }
    return originalFetch(url, options);
  };
  const late = service.getVendor(record.id);
  await arrived;
  await session.logoutAdmin();
  release();
  await assert.rejects(late, /session changed/i);
});
