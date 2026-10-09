import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCents, formatCents, formatAmount, targetDraftErrors, sumDraft } from './salesTargetFields.js';

test('sales target amounts are exact BigInt values', () => {
  assert.equal(parseCents('999999999999.99'), 99999999999999n);
  assert.equal(parseCents('1000000000000'), null);
  assert.equal(parseCents('1.234'), null);
  assert.equal(parseCents('-1'), null);
  assert.equal(formatAmount('999999999999.99'), '₹9,99,99,99,99,999.99');
  assert.equal(formatAmount('invalid'), '—');
  assert.equal(formatCents(sumDraft({ q1: '0.10', q2: '0.20', q3: '0', q4: '0' })), '₹0.3');
  assert.deepEqual(targetDraftErrors({ mrId: 'a', startYear: '2025', endYear: '2026', q1: '1', q2: '2', q3: '3', q4: '4.5', status: 'active' }), {});
  assert.ok(targetDraftErrors({ mrId: 'a', startYear: '2025', endYear: '2027', q1: '1', q2: '2', q3: '3', q4: '4', status: 'active' }).endYear);
});

test('sales target transport sends filters, versions, confirmations and downloads', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_k, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    url = String(url);
    if (url.startsWith('/api/v1/auth')) {
      return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { user, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
    }
    calls.push({ url, options });
    if (/\/(?:export|sample)\?/.test(url)) return new Response(new Blob(['x']), { status: 200, headers: { 'X-Download-Log': '00000000-0000-0000-0000-000000000009' } });
    return new Response(JSON.stringify({ items: [], total: 0, filtered: 0, digest: 'confirmation' }), { status: 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverSalesTargets.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  const record = { id: '00000000-0000-0000-0000-000000000001', version: 3 };
  await service.listSalesTargets({ query: 'A', status: 'all', zoneId: '', startYear: 2025, limit: 10, offset: 0 });
  assert.match(calls[0].url, /\/api\/v1\/admin\/sales-targets\?query=A&status=all&startYear=2025&limit=10&offset=0/);
  await service.salesTargetChoices({ query: 'x', zoneQuery: undefined, limit: 20 });
  assert.match(calls[1].url, /sales-targets\/choices\?query=x&limit=20/);
  await service.editSalesTarget(record, { q1: '1.00' });
  assert.deepEqual(JSON.parse(calls[2].options.body), { q1: '1.00', expected_version: 3 });
  await service.statusSalesTarget(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[3].options.body), { status: 'inactive', expected_version: 3 });
  await service.deleteSalesTarget(record);
  assert.deepEqual(JSON.parse(calls[4].options.body), { expected_version: 3 });
  const file = Object.assign(new Blob(['b']), { name: 'targets.csv' });
  await service.importSalesTargets(file, 'dig');
  assert.match(calls[5].url, /import\/commit\?filename=targets\.csv&digest=dig&confirm=true/);
  await service.exportSalesTargets({ status: 'active' }, 'xlsx');
  assert.match(calls[6].url, /export\?status=active&format=xlsx/);
  assert.ok(calls[6].options.headers['X-Download-Initiation']);
  await session.logoutAdmin();
});
