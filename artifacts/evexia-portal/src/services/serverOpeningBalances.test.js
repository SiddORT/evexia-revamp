import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBalance, formatBalance } from './openingBalanceValidation.js';

test('exact signed money and year validation never convert monetary cents through Number', () => {
  const fields = { startYear: '9998', endYear: '9999', doctorId: 'shared', amount: '-9999999999999.99', status: 'active' };
  assert.deepEqual(validateBalance(fields), {});
  assert.equal(formatBalance(fields.amount), '-99,99,99,99,99,999.99');
  assert.equal(formatBalance('0.00'), '0.00');
  assert.equal(formatBalance('1250.50'), '1,250.50');
  for (const amount of ['1.000', '1.234', '1e2', 'Infinity', '10000000000000.00', '-10000000000000']) assert.ok(validateBalance({ ...fields, amount }).amount, amount);
  assert.ok(validateBalance({ ...fields, startYear: '1899' }).startYear);
  assert.ok(validateBalance({ ...fields, endYear: '9998' }).endYear);
});

test('Opening Balance transport sends exact strings, versions, bounded reference params and guarded downloads', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_key, fn) => fn() } } });
  const admin = { id: 'synthetic-admin', email: 'test@example.com', system_role: 'super_admin', permissions: ['admin.access'] };
  const record = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', version: 7 };
  const calls = [];
  let mode = '', arrived, release;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/admin/opening-balances')) {
      if (mode === 'uncertain') throw new TypeError('Synthetic lost reply');
      if (mode === 'late') return { ok: true, status: 200, json: () => { arrived(); return new Promise((resolve) => { release = () => resolve({ items: [] }); }); } };
      if (mode === 'renew') { mode = ''; return new Response('{}', { status: 401 }); }
      if (url.includes('/export') || url.includes('/sample')) return new Response('bytes', { headers: mode === 'unlogged' ? {} : { 'X-Download-Log': record.id } });
      return Response.json(url.includes('/references') ? { items: [], total: 70, limit: 50, offset: 50 } : record);
    }
    if (url.includes('/auth/logout')) return Response.json({});
    if (url.includes('/auth/me')) return Response.json(admin);
    if (url.includes('/auth/refresh') || url.includes('/auth/login')) return Response.json({ access_token: 'synthetic-token', expires_in: 900 });
    throw new Error(`Unexpected URL ${url}`);
  };
  const auth = await import('../auth/adminSession.js');
  const service = await import('./serverOpeningBalances.js');
  await auth.loginAdmin('synthetic', 'not-a-real-password');
  const values = { startYear: 2026, endYear: 2027, doctorId: record.id, amount: '-9999999999999.99', status: 'active' };
  await service.createOpeningBalance(values);
  assert.equal(JSON.parse(calls.at(-1).options.body).amount, values.amount);
  await service.editOpeningBalance(record, values);
  assert.equal(JSON.parse(calls.at(-1).options.body).expected_version, 7);
  await service.statusOpeningBalance(record, 'inactive');
  await service.deleteOpeningBalance(record);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { expected_version: 7 });
  await service.openingBalanceDoctors({ query: 'REG%', limit: 50, offset: 50, balance_id: record.id });
  assert.match(calls.at(-1).url, /query=REG%25/);
  assert.match(calls.at(-1).url, /offset=50/);
  assert.match(calls.at(-1).url, /balance_id=/);
  const blob = await service.exportOpeningBalances({ query: '2026', status: 'inactive' }, 'xlsx');
  assert.equal(calls.at(-1).options.headers['X-Download-Initiation'].length, 36);
  mode = 'unlogged';
  await assert.rejects(service.sampleOpeningBalances('csv'), /logging could not be confirmed/);
  mode = 'uncertain';
  await assert.rejects(service.createOpeningBalance(values), (error) => error.ambiguous);
  mode = 'renew';
  await assert.rejects(service.editOpeningBalance(record, values), /Session renewed.*draft is preserved/);
  assert.equal(auth.getSession().status, 'authenticated');
  mode = '';
  await service.editOpeningBalance(record, values);
  mode = 'late';
  const entered = new Promise((resolve) => { arrived = resolve; });
  const pending = service.listOpeningBalances({ query: 'old-owner' });
  await entered;
  await auth.logoutAdmin();
  release();
  await assert.rejects(pending, /session changed/i);
  assert.throws(() => auth.serverDownloadGuard(blob), /identity changed|session|sign in/i);
});
